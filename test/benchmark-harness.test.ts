import { describe, expect, it } from 'vitest'
import {
  parseBenchmarkOptions,
  runConcurrent,
  runSequential
} from '../benchmark/harness'

const defaults = {
  operations: 100,
  concurrency: 10,
  warmup: 5,
  samples: 20
}

describe('benchmark option parsing', () => {
  it('should parse separated and inline values', () => {
    expect(parseBenchmarkOptions([
      '--',
      '--operations', '200',
      '--concurrency=25',
      '--output', 'report.json'
    ], defaults)).toEqual({
      operations: 200,
      concurrency: 25,
      warmup: 5,
      samples: 20,
      output: 'report.json'
    })
  })

  it('should reject unknown options and missing values', () => {
    expect(() => parseBenchmarkOptions([
      '--unknown', '1'
    ], defaults)).toThrow('Unknown benchmark option --unknown')
    expect(() => parseBenchmarkOptions([
      '--operations', '--warmup', '1'
    ], defaults)).toThrow('Missing value for --operations')
    expect(() => parseBenchmarkOptions([
      '--output'
    ], defaults)).toThrow('Missing value for --output')
  })

  it('should stop parsing at the option delimiter', () => {
    expect(parseBenchmarkOptions([
      '--operations', '200',
      '--',
      '--warmup', '1'
    ], defaults)).toMatchObject({
      operations: 200,
      warmup: 5
    })
  })
})

describe('benchmark latency sampling', () => {
  it('should bound and spread sequential latency samples', async () => {
    let completed = 0
    const result = await runSequential(20, async () => {
      completed += 1
    }, 4)

    expect(completed).toBe(20)
    expect(result.operations).toBe(20)
    expect(result.latencySamples).toBe(4)
  })

  it('should bound concurrent samples without dropping operations', async () => {
    let completed = 0
    const result = await runConcurrent(25, 4, async () => {
      await Promise.resolve()
      completed += 1
    }, 6)

    expect(completed).toBe(25)
    expect(result.operations).toBe(25)
    expect(result.latencySamples).toBe(6)
  })

  it('should sample every operation below the limit', async () => {
    const result = await runSequential(
      3,
      async () => undefined,
      10
    )

    expect(result.latencySamples).toBe(3)
  })
})
