# Npora Request Features

> Product feature definition of Npora Request.

---

# Core

The Core defines the foundation of the library.

Core features should remain stable.

---

## Client

### Instance

- [ ] createClient()
- [ ] createClient().extend()

### Request API

- [ ] request()
- [ ] get()
- [ ] post()
- [ ] put()
- [ ] patch()
- [ ] delete()

---

## Config

### Base

- [ ] baseURL
- [ ] headers
- [ ] query
- [ ] body

### Request

- [ ] json
- [ ] form
- [ ] formData

### Control

- [ ] timeout
- [ ] signal

### Response

- [ ] responseType
- [ ] validateStatus

---

## Pipeline

- [ ] Config Merge

- [ ] Request Pipeline

- [ ] Request Context

---

## Adapter

### Built-in

- [ ] Fetch Adapter

### Future

- [ ] Node Adapter

- [ ] Mock Adapter

---

## Parser

- [ ] JSON

- [ ] Text

- [ ] Blob

- [ ] ArrayBuffer

- [ ] Stream

---

## Error

- [ ] RequestError

- [ ] HTTP Error

- [ ] Network Error

- [ ] Timeout Error

- [ ] Abort Error

---

# Extensions

Everything below should be implemented as extensions.

---

## Retry

- [ ] Retry

- [ ] Retry Delay

- [ ] Retry Condition

---

## Cache

- [ ] Memory Cache

- [ ] TTL

- [ ] Custom Cache Key

---

## Authentication

- [ ] Authorization Header

- [ ] Refresh Token

- [ ] Token Storage

---

## Upload

- [ ] Upload

- [ ] Upload Progress

---

## Download

- [ ] Download

- [ ] Download Progress

---

## Logger

- [ ] Request Logger

- [ ] Response Logger

- [ ] Error Logger

---

## Mock

- [ ] Mock Adapter

---

# Interceptors

- [ ] Request Interceptor

- [ ] Response Interceptor

- [ ] Error Interceptor

---

# Utilities

- [ ] Query Builder

- [ ] URL Builder

- [ ] Header Merge

- [ ] Body Serializer

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

- [ ] Node.js

- [ ] Web Worker

---

# TypeScript

- [ ] Complete Type Definitions

- [ ] Generic Request

- [ ] Generic Response

- [ ] Generic Error

---

# Testing

- [ ] Unit Tests

- [ ] Integration Tests

- [ ] Browser Tests

---

# Documentation

- [ ] README

- [ ] Blueprint

- [ ] Structure

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
