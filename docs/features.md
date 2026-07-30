# Npora Request Features

> Product feature definition of Npora Request.

---

# Core

The Core defines the foundation of the library.

Core features should remain stable.

---

## Client

### Instance

- [x] createClient()
- [x] createClient().extend()

### Request API

- [x] request()
- [x] get()
- [x] post()
- [x] put()
- [x] patch()
- [x] delete()

---

## Config

### Base

- [x] baseURL
- [x] Native Fetch Options
- [x] headers
- [x] query
- [x] body

### Request

- [x] json
- [x] form
- [x] formData

### Control

- [x] timeout
- [x] signal

### Response

- [x] responseType
- [x] validateStatus
- [x] Complete Response API

---

## Pipeline

- [x] Config Merge
- [x] Case-insensitive Header Merge
- [x] Query Merge
- [x] Nested Option Merge
- [x] Request Config Validation
- [x] Request Pipeline
- [x] Request Context

---

## Adapter

### Built-in

- [x] Fetch Adapter

### Future

- [ ] Node Adapter
- [x] Mock Adapter

---

## Parser

- [x] JSON
- [x] Text
- [x] Blob
- [x] ArrayBuffer
- [x] Stream

---

## Error

- [x] RequestError
- [x] HTTP Error
- [x] Network Error
- [x] Timeout Error
- [x] Abort Error

---

# Extensions

Everything below should be implemented as extensions.

- [x] Namespaced Extension Config
- [x] Typed Extension Registry
- [x] Third-party Config Augmentation
- [x] Legacy Config Compatibility
- [x] Plugin Priority
- [x] Plugin Dependencies
- [x] Plugin Conflicts
- [x] Plugin Uninstall
- [x] Scoped Registration Cleanup
- [x] Install Rollback

---

## Retry

- [x] Retry
- [x] Retry Delay
- [x] Retry Condition
- [x] Idempotent Method Guard
- [x] Retry-After
- [x] Abortable Backoff

---

## Cache

- [x] Memory Cache
- [x] TTL
- [x] Custom Cache Key
- [x] Per-client Isolation
- [x] Authorization-aware Cache Key
- [x] Cache Method Guard

---

## Authentication

- [x] Authorization Header
- [x] Refresh Token
- [x] Token Storage

---

## Upload

- [x] Upload
- [ ] Upload Progress

---

## Download

- [x] Download
- [x] Download Progress

---

## Logger

- [x] Request Logger
- [x] Response Logger
- [x] Error Logger

---

## Mock

- [x] Mock Adapter

---

# Interceptors

- [x] Request Interceptor
- [x] Response Interceptor
- [x] Error Interceptor
- [x] Interceptor Priority

---

# Utilities

- [x] Query Builder
- [x] URL Builder
- [x] Header Merge
- [x] Body Serializer

---

# Browser Compatibility

Supported:

- [ ] Chrome
- [ ] Edge
- [ ] Firefox
- [ ] Safari

---

# Runtime

Supported:

- [ ] Browser
- [x] Node.js
- [ ] Web Worker

---

# TypeScript

- [x] Complete Type Definitions
- [x] Generic Request
- [x] Generic Response
- [x] Generic Error

---

# Testing

- [x] Unit Tests
- [ ] Integration Tests
- [ ] Browser Tests

---

# Documentation

- [ ] README
- [x] Blueprint
- [x] Structure
- [ ] Examples

---

# Release

## v0.1

Core

---

## v0.2

Request

- Timeout
- Abort
- Retry
- Cache

---

## v0.3

Business

- Auth
- Logger
- Upload
- Download

---

## v1.0

Stable API

Production Ready
