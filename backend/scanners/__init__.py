"""Stock scanner modules — pure-Python signal builders that read from the
shared OHLCV caches (currently `backend/breadth/grouped`) and return ranked
candidate lists. Each scanner is independent and can be invoked from a
dedicated FastAPI route.
"""
