class EngineError(Exception):
    """A user-facing error with an HTTP status (404 unknown thing, 409 state conflict...)."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status
