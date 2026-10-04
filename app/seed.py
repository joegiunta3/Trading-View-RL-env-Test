"""Build a seed's world, write the SQLite DB and world_truth.json, print the world hash.

python -m app.seed --seed 1234 [--out data]
"""

import argparse
import json
from pathlib import Path

from app.config import DATA_DIR
from app.db import connect, world_hash, write_world
from app.world.generate import build_world
from app.world.truth import write_truth


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--out", type=Path, default=DATA_DIR)
    args = parser.parse_args()
    out = args.out / f"seed-{args.seed}"
    out.mkdir(parents=True, exist_ok=True)
    db_path = out / "world.db"
    db_path.unlink(missing_ok=True)
    world = build_world(args.seed)
    conn = connect(db_path)
    write_world(conn, world)
    truth_path = write_truth(world, out)
    print(
        json.dumps(
            {
                "seed": args.seed,
                "world_hash": world_hash(conn, world.truth_json),
                "db": str(db_path),
                "world_truth": str(truth_path),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
