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
- [x] head()
- [x] options()

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
- [x] Timeout/Signal Resource Cleanup

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
- [x] Final Plugin Config Validation
- [x] GET/HEAD Body Guard
- [x] Request Pipeline
- [x] Request Context
- [x] Unified Pipeline Error Lifecycle
- [x] Short-circuit Response Lifecycle

---

## Adapter

### Built-in

- [x] Fetch Adapter
- [x] Validated Header Handoff
- [x] Data-only Response Clone Elision
- [x] Allocation-aware Request Construction
- [x] Node.js via Fetch Adapter
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
- [x] Deterministic Cache Key
- [x] Response Type Cache Isolation
- [x] Cache Method Guard

---

## Authentication

- [x] Authorization Header
- [x] Refresh Token
- [x] Token Storage
- [x] Concurrent Refresh Deduplication
- [x] Refresh Failure Recovery

---

## Upload

- [x] Upload
- [x] Native XHR Upload Progress
- [x] Concurrent Upload Stress Tests

---

## Download

- [x] Download
- [x] Download Progress
- [x] Fetch Stream Progress
- [x] Native XHR Progress Fallback
- [x] Concurrent Download Stress Tests

---

## Logger

- [x] Request Logger
- [x] Response Logger
- [x] Error Logger
- [x] Sensitive Log Redaction

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

- [x] Chrome (Chromium)
- [x] Edge (Chromium)
- [x] Safari (WebKit)

Firefox is outside the current verification scope.

---

# Runtime

Supported:

- [x] Browser
- [x] Node.js
- [x] Web Worker

---

# TypeScript

- [x] Complete Type Definitions
- [x] Generic Request
- [x] Generic Response
- [x] Generic Error

---

# Testing

- [x] Unit Tests
- [x] Integration Tests
- [x] Browser Tests
- [x] Node.js 22/24/26 Runtime Matrix
- [x] Coverage Regression Gate
- [x] Request Pipeline Performance Benchmarks
- [x] Machine-readable Benchmark Reports
- [x] Ten-library Ecosystem Evaluation
- [x] Rotating Multi-sample Comparison Runs
- [x] Competitor Dependency Cleanup
- [x] Cached Interceptor and Hook Ordering
- [x] Empty Pipeline Fast Path
- [x] Allocation-aware Config Merge
- [x] Single-pass Header Normalization
- [x] Package Size Regression Gate
- [x] Machine-readable Package Size Reports

---

# Documentation

- [x] README
- [x] Blueprint
- [x] Structure
- [x] Examples
- [x] Example Typecheck

---

# Release

## Package Verification

- [x] ESM Entrypoint
- [x] CommonJS Entrypoint
- [x] Package Exports Smoke Test
- [x] Tarball Manifest Verification
- [x] Package Size Budget Verification

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
