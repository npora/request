export function isPromiseLike<T>(
  value: T | PromiseLike<T>
): value is PromiseLike<T> {
  return (
    value !== null &&
    (
      typeof value === 'object' ||
      typeof value === 'function'
    ) &&
    typeof (value as PromiseLike<T>).then === 'function'
  )
}
