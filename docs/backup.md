# Backup

Everything lives in `DATA_DIR`:

- `pocket-collaborator.db`: SQLite in WAL mode (reviews, comments, the log, review time)
- `files/`: the documents, named by their SHA-256
- `core.token*`: only with Pocket Core

For a consistent database copy while the app runs:

```sh
docker exec pocket-collaborator pocket-collaborator backup   # → /data/backups/pocket-collaborator-<time>.db
```

Back up that file and `files/`. Do not copy the live `.db` without its `-wal`, and do not put the database on NFS (WAL needs real file locks).

There is no whole-database download over HTTP: the file holds everyone's reviews.
