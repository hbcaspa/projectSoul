const Cache = require('xache')

module.exports = class AdaptiveTimeout {
  constructor(opts = {}) {
    this._cache = new Cache({
      maxSize: opts.maxSize || 65536,
      maxAge: opts.maxAge || 10 * 60 * 1000 // 10 minutes
    })
    this._fallback = opts.fallback || AdaptiveTimeout.TimeoutExponential
    this._min = opts.min ?? 300
    this._max = opts.max || 4000
    this._jitter = opts.jitter ?? 256
  }

  // Default - aggressive ramp
  static TimeoutAggressive = [500, 750, 1000, 1500, 2000]

  // Linear - steady increase
  static TimeoutLinear = [500, 1000, 1500, 2000, 2500]

  // Exponential - slow start, rapid backoff
  static TimeoutExponential = [250, 500, 1000, 2000, 4000]

  // Gentle - conservative, patient
  static TimeoutGentle = [1000, 1250, 1500, 1750, 2000]

  // Fast - rapid fire retries
  static TimeoutFast = [200, 400, 600, 800, 1000]

  // U-shape - long, short, long
  static TimeoutUShape = [1500, 750, 500, 750, 1500]

  // Inverse U - short, long, short
  static TimeoutInverseU = [500, 1000, 1500, 1000, 500]

  // Sawtooth - alternating fast/slow
  static TimeoutSawtooth = [500, 1500, 500, 1500, 500]

  // Plateau - quick ramp then steady
  static TimeoutPlateau = [500, 1000, 2000, 2000, 2000]

  // Logarithmic - diminishing increases
  static TimeoutLogarithmic = [500, 1000, 1300, 1500, 1600]

  getValue(key) {
    return this._cache.get(key)
  }

  put(key, value) {
    let p = this._cache.get(key)

    if (!p) {
      p = { avg: value, variance: value >> 1 }
    } else {
      // blend 75% old + 25% new deviation
      p.variance += (Math.abs(p.avg - value) - p.variance) >> 2
      // blend 87.5% old + 12.5% new sample
      p.avg += (value - p.avg) >> 3
    }

    this._cache.set(key, p)

    return p
  }

  get(key, attempt = 1) {
    const p = this._cache.get(key)
    const jitter = (Math.random() * this._jitter) | 0

    if (p) {
      // known - use adaptive with linear backoff
      const base = p.avg + (p.variance << 1)
      const backoff = base * attempt
      return Math.min(Math.max(backoff + jitter, this._min), this._max)
    } else {
      // unknown - use aggressive fallback
      const base = this._fallback[Math.min(attempt - 1, this._fallback.length - 1)]
      return base + jitter
    }
  }

  has(key) {
    return this._cache.has(key)
  }

  delete(key) {
    return this._cache.delete(key)
  }

  clear() {
    this._cache.clear()
  }
}
