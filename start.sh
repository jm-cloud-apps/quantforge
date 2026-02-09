#!/bin/bash
# Start both backend and frontend for Stock Backtester

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Kill background processes on exit
cleanup() {
  echo ""
  echo "Shutting down..."
  kill $BACKEND_PID 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

# Start backend
echo "Starting backend (Python FastAPI) on http://localhost:8000 ..."
cd backend
if [ ! -d "venv" ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv venv
fi
source venv/bin/activate

# Only install deps when venv is new or fastapi missing (speeds up subsequent starts)
if ! python -c "import fastapi" 2>/dev/null; then
  echo "Installing backend dependencies (first run only)..."
  pip install -r requirements.txt || { echo "pip install failed. Try: cd backend && source venv/bin/activate && pip install -r requirements.txt"; exit 1; }
fi

python -m uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd ..

# Give backend a moment to start
sleep 2

# Start frontend
echo "Starting frontend (React) on http://localhost:5173 ..."
cd frontend
npm run dev
