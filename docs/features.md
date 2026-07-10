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
- [ ] createClient().extend()

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

---

## Pipeline

- [x] Config Merge
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

---

## Retry

- [x] Retry
- [x] Retry Delay
- [x] Retry Condition

---

## Cache

- [x] Memory Cache
- [x] TTL
- [x] Custom Cache Key

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
- [ ] Download Progress

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
- [ ] Generic Error

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
