/**
 * Nova Request
 * HTTP 请求方法类型定义
 *
 * 定义所有支持的 HTTP Method。
 * 该类型用于约束 RequestConfig.method。
 */

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'DELETE'
  | 'PATCH'
  | 'HEAD'
  | 'OPTIONS'