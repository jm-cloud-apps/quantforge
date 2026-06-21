"""JSON-safety helper.

Starlette's JSONResponse encodes with allow_nan=False, so a single NaN/Infinity
float anywhere in the payload turns the whole response into a 500. Market math
(divisions, correlations, ratios) can produce those, so every response is run
through json_safe to coerce non-finite floats to None.
"""

import math


def json_safe(obj):
    """Recursively replace non-finite floats (NaN, ±Inf) with None."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [json_safe(v) for v in obj]
    return obj
