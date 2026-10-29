package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"testing"
)

func (h *harness) uploadImage(who string, rid int64, data []byte) (int, int64) {
	h.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("file", "image.png")
	fw.Write(data)
	mw.Close()
	req, _ := http.NewRequest("POST", fmt.Sprintf("%s/api/v1/reviews/%d/images", h.http.URL, rid), &buf)
	req.Header.Set("Authorization", "Bearer "+h.tok[who])
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer res.Body.Close()
	var out struct {
		ID int64 `json:"id"`
	}
	b, _ := io.ReadAll(res.Body)
	_ = json.Unmarshal(b, &out)
	return res.StatusCode, out.ID
}

func (h *harness) get(who, path string) (int, string) {
	h.t.Helper()
	req, _ := http.NewRequest("GET", h.http.URL+"/api/v1"+path, nil)
	req.Header.Set("Authorization", "Bearer "+h.tok[who])
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	res.Body.Close()
	return res.StatusCode, res.Header.Get("Content-Type")
}

func tinyPNG() []byte {
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{255, 0, 0, 255})
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

func TestCommentPictures(t *testing.T) {
	h := newHarness(t)
	rid := h.setup()
	other := h.setup()

	// only pictures; observers cannot add them
	code, _ := h.uploadImage("rita", rid, []byte("%PDF-1.4 not a picture"))
	must(t, code, 415, "pdf as picture")
	code, _ = h.uploadImage("oscar", rid, tinyPNG())
	must(t, code, 403, "observer uploads a picture")
	code, img := h.uploadImage("rita", rid, tinyPNG())
	must(t, code, 201, "upload picture")
	code, again := h.uploadImage("ben", rid, tinyPNG())
	must(t, code, 201, "same picture again")
	if again != img {
		t.Fatalf("the same picture was stored twice (%d, %d)", img, again)
	}

	// a comment may be just a picture; a picture of another review is refused
	code, c := h.do("rita", "POST", fmt.Sprintf("/reviews/%d/comments", rid), map[string]any{"page": 1, "images": []int64{img}})
	must(t, code, 201, "picture-only comment")
	if imgs := c["images"].([]any); len(imgs) != 1 || int64(imgs[0].(float64)) != img {
		t.Fatalf("comment images = %v", c["images"])
	}
	code, _ = h.do("olga", "POST", fmt.Sprintf("/reviews/%d/comments", other), map[string]any{"page": 1, "images": []int64{img}})
	must(t, code, 400, "picture from another review")
	code, _ = h.do("rita", "POST", fmt.Sprintf("/reviews/%d/comments", rid), map[string]any{"page": 1})
	must(t, code, 400, "empty comment")

	// everyone on the review sees it; nobody else does
	code, ct := h.get("oscar", fmt.Sprintf("/reviews/%d/images/%d", rid, img))
	must(t, code, 200, "observer sees the picture")
	if ct != "image/png" {
		t.Fatalf("content type %q", ct)
	}
	code, _ = h.get("adam", fmt.Sprintf("/reviews/%d/images/%d", rid, img))
	must(t, code, 404, "admin not on the review")
	code, _ = h.get("olga", fmt.Sprintf("/reviews/%d/images/%d", other, img))
	must(t, code, 404, "picture through another review")

	// editing the text keeps the pictures; an empty list removes them
	cid := int64(c["id"].(float64))
	code, c = h.do("rita", "PUT", fmt.Sprintf("/reviews/%d/comments/%d", rid, cid), map[string]any{"body": "see the screenshot"})
	must(t, code, 200, "edit text")
	if len(c["images"].([]any)) != 1 {
		t.Fatalf("edit dropped the picture: %v", c["images"])
	}
	code, c = h.do("rita", "PUT", fmt.Sprintf("/reviews/%d/comments/%d", rid, cid), map[string]any{"body": "no picture", "images": []int64{}})
	must(t, code, 200, "remove picture")
	if len(c["images"].([]any)) != 0 {
		t.Fatalf("picture not removed: %v", c["images"])
	}
}
