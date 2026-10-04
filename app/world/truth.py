"""world_truth.json writer. Files go under DATA_DIR/episodes/<id>/, never a served dir."""

from pathlib import Path

from app.world.generate import World


def write_truth(world: World, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "world_truth.json"
    path.write_text(world.truth_json)
    return path
