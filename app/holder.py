"""Holds the single live Episode shared by the public and env apps."""

import gc
import os
import secrets
import threading
from pathlib import Path

from app.config import DATA_DIR, ENV_TOKEN_VAR
from app.episode import Episode


class EnvHolder:
    def __init__(
        self, data_dir: Path | None = DATA_DIR, token: str | None = None, **episode_kwargs
    ):
        self.data_dir = data_dir
        self.token = token or os.environ.get(ENV_TOKEN_VAR) or secrets.token_urlsafe(24)
        self.episode: Episode | None = None
        self._episode_kwargs = episode_kwargs
        self._lock = threading.Lock()

    def reset(
        self, seed: int, start_time: str, clock_mode: str, setup: dict | None, start_day: int = 1
    ) -> Episode:
        with self._lock:
            kwargs = dict(self._episode_kwargs)
            if self.data_dir is not None:
                self.data_dir.mkdir(parents=True, exist_ok=True)
                kwargs.setdefault("db_path", self.data_dir / "chartview.db")
                kwargs.setdefault("truth_dir", self.data_dir / "episodes")
            old, self.episode = self.episode, None
            if old is not None:  # free the old world before building the next one
                with old.lock:
                    old.conn.close()
                del old
                gc.collect()
            self.episode = Episode(
                seed, start_time, clock_mode, setup, start_day=start_day, **kwargs
            )
            return self.episode
