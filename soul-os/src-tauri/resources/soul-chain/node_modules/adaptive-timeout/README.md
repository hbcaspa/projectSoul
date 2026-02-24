# adaptive-timeout

Adaptive timeout calculation with EWMA-based tracking and fallback strategies.

## Install

```
npm install adaptive-timeout
```

## Usage

```js
const AdaptiveTimeout = require('adaptive-timeout')

const timeouts = new AdaptiveTimeout()

// Record a sample when you get a response
timeouts.put('10.0.0.1:8080', 150)

// Get timeout for next request (attempt 1, 2, 3...)
timeouts.get('10.0.0.1:8080', 1) // adaptive based on recorded samples
timeouts.get('unknown-peer', 1) // uses fallback strategy
```

## API

#### `const timeouts = new AdaptiveTimeout([options])`

Create a new instance.

Options:

- `maxSize` - max cache entries (default: `65536`)
- `maxAge` - entry TTL in ms (default: `600000` / 10 minutes)
- `fallback` - timeout sequence for unknown keys (default: `[500, 750, 1000, 1500, 2000]`)
- `min` - minimum timeout for known keys (default: `300`)
- `max` - maximum timeout for known keys (default: `5000`)
- `jitter` - random jitter range in ms (default: `256`)

#### `timeouts.put(key, value)`

Record a sample. Updates the exponentially weighted moving average.

Returns `{ avg, variance }`.

#### `timeouts.get(key, [attempt])`

Get a timeout value.

For known keys: calculates adaptive timeout with linear backoff based on attempt number.

For unknown keys: returns value from fallback sequence based on attempt number.

#### `timeouts.getValue(key)`

Get raw stats for a key. Returns `{ avg, variance }` or `null`.

#### `timeouts.has(key)`

Check if a key exists.

#### `timeouts.delete(key)`

Remove a key.

#### `timeouts.clear()`

Remove all entries.

#### `timeouts.size`

Number of entries.

## How it works

Uses TCP-style EWMA (exponentially weighted moving average) to track values:

- `avg` blends 87.5% old + 12.5% new sample
- `variance` blends 75% old + 25% new deviation

Timeout for known keys: `(avg + 2 * variance) * attempt + jitter`

Unknown keys use an aggressive fallback sequence to probe quickly.

## License

Apache 2.0
