"""JSON-safety helper — Starlette's JSONResponse rejects NaN/Infinity, so coerce
non-finite floats to None before returning."""

import math


def json_safe(obj):
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [json_safe(v) for v in obj]
    return obj
