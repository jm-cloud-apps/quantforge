"""Singleton broker instance management."""

from .connection import IBConnection

_broker = None


def get_broker() -> IBConnection:
    global _broker
    if _broker is None:
        _broker = IBConnection()
    return _broker
