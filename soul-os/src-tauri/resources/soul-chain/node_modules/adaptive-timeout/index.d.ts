declare module '@holepunchto/adaptive-timeout' {
  interface AdaptiveTimeoutOptions {
    maxSize?: number
    maxAge?: number
    fallback?: number[]
    min?: number
    max?: number
    jitter?: number
  }

  interface Stats {
    avg: number
    variance: number
  }

  declare class AdaptiveTimeout {
    constructor(opts?: AdaptiveTimeoutOptions)

    getValue(key: string): Stats | null
    put(key: string, value: number): Stats
    get(key: string, attempt?: number): number
    has(key: string): boolean
    delete(key: string): boolean
    clear(): void

    // Default - aggressive ramp
    static TimeoutAggressive: string[]

    // Linear - steady increase
    static TimeoutLinear: string[]

    // Exponential - slow start, rapid backoff
    static TimeoutExponential: string[]

    // Gentle - conservative, patient
    static TimeoutGentle: string[]

    // Fast - rapid fire retries
    static TimeoutFast: string[]

    // U-shape - long, short, long
    static TimeoutUShape: string[]

    // Inverse U - short, long, short
    static TimeoutInverseU: string[]

    // Sawtooth - alternating fast/slow
    static TimeoutSawtooth: string[]

    // Plateau - quick ramp then steady
    static TimeoutPlateau: string[]

    // Logarithmic - diminishing increases
    static TimeoutLogarithmic: string[]
  }

  export = AdaptiveTimeout
}
