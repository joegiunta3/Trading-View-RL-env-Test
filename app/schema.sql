-- Money and prices are integer cents unless the column says otherwise.

-- World tables (immutable after generation; part of the determinism hash)
CREATE TABLE symbols (
    id INTEGER PRIMARY KEY,
    ticker TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    sector TEXT NOT NULL,
    spread INTEGER NOT NULL
);
CREATE TABLE path (
    symbol_id INTEGER NOT NULL,
    sim_sec INTEGER NOT NULL,
    price INTEGER NOT NULL,
    volume INTEGER NOT NULL,
    PRIMARY KEY (symbol_id, sim_sec)
) WITHOUT ROWID;
CREATE TABLE intraday_bars (     -- prior sessions at 1-minute resolution
    symbol_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    minute INTEGER NOT NULL,         -- 0 = 09:00 .. 449 = 16:29
    o INTEGER NOT NULL,
    h INTEGER NOT NULL,
    l INTEGER NOT NULL,
    c INTEGER NOT NULL,
    v INTEGER NOT NULL,
    PRIMARY KEY (symbol_id, date, minute)
) WITHOUT ROWID;
CREATE TABLE daily_bars (            -- derived from intraday_bars
    symbol_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    o INTEGER NOT NULL,
    h INTEGER NOT NULL,
    l INTEGER NOT NULL,
    c INTEGER NOT NULL,
    v INTEGER NOT NULL,
    PRIMARY KEY (symbol_id, date)
);

-- Episode state
CREATE TABLE account (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    cash INTEGER NOT NULL,
    start_cash INTEGER NOT NULL,
    realized_pnl INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE positions (
    symbol_id INTEGER PRIMARY KEY,
    qty INTEGER NOT NULL,            -- negative = short
    avg_price REAL NOT NULL,         -- dollars, derived from cost_basis / |qty|
    cost_basis INTEGER NOT NULL      -- entry notional of the open qty, cents
);
CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    symbol_id INTEGER NOT NULL,
    side TEXT NOT NULL,              -- buy | sell | short | cover
    type TEXT NOT NULL,              -- market | limit | stop
    qty INTEGER NOT NULL,
    limit_price INTEGER,
    stop_price INTEGER,
    status TEXT NOT NULL,            -- working | filled | cancelled | rejected
    created_sim_ts INTEGER NOT NULL,
    triggered_sim_ts INTEGER,
    filled_sim_ts INTEGER,
    fill_price INTEGER,
    closed_sim_ts INTEGER,
    reason TEXT
);
CREATE TABLE trades (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL,
    symbol_id INTEGER NOT NULL,
    side TEXT NOT NULL,
    qty INTEGER NOT NULL,
    price INTEGER NOT NULL,
    realized_pnl INTEGER NOT NULL DEFAULT 0,
    sim_ts INTEGER NOT NULL
);
CREATE TABLE watchlists (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);
CREATE TABLE watchlist_items (
    watchlist_id INTEGER NOT NULL,
    symbol_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (watchlist_id, symbol_id)
);
CREATE TABLE alerts (
    id INTEGER PRIMARY KEY,
    symbol_id INTEGER NOT NULL,
    condition TEXT NOT NULL,         -- above | below | crossing_up | crossing_down
    price INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_sim_ts INTEGER NOT NULL,
    triggered_sim_ts INTEGER
);
CREATE TABLE alert_events (
    id INTEGER PRIMARY KEY,
    alert_id INTEGER NOT NULL,
    symbol_id INTEGER NOT NULL,
    condition TEXT NOT NULL,
    price INTEGER NOT NULL,
    trigger_price INTEGER NOT NULL,
    sim_ts INTEGER NOT NULL
);
CREATE TABLE chart_panes (           -- the four chart panes; layout decides how many are shown
    pane_index INTEGER PRIMARY KEY CHECK (pane_index BETWEEN 0 AND 3),
    symbol_id INTEGER NOT NULL,
    timeframe TEXT NOT NULL,
    indicators_json TEXT NOT NULL
);
CREATE TABLE ui_state (             -- keys: layout ("1".."4"), active_pane ("0".."3")
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE action_log (
    id INTEGER PRIMARY KEY,
    wall_ts REAL NOT NULL,           -- real time; never used for grading or hashing
    sim_ts INTEGER NOT NULL,
    endpoint TEXT NOT NULL,
    payload TEXT NOT NULL
);
CREATE INDEX orders_status ON orders (status);
