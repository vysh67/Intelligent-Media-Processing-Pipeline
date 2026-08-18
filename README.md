# Intelligent Media Processing Pipeline

> **Backend + AI Engineering Assignment for gOGig (Ginger Media Group)**  
> An asynchronous, resilient computer vision and media analysis engine designed for real-world transit advertisement verification and quality assurance.

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)]()
[![Tests](https://img.shields.io/badge/tests-100%25%20passing-success.svg)]()
[![Runtime](https://img.shields.io/badge/node-v20%2B-blue.svg)]()
[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)]()
[![License](https://img.shields.io/badge/license-MIT-green.svg)]()

---

## Table of Contents
1. [Overview & Problem Statement](#overview--problem-statement)
2. [System Architecture & Design](#system-architecture--design)
   - [Service Flow](#service-flow)
   - [Processing Flow & Analyzers](#processing-flow--analyzers)
   - [Queue Strategy & State Machine](#queue-strategy--state-machine)
   - [Major Design Decisions](#major-design-decisions)
3. [Image Analysis Engines & Heuristics](#image-analysis-engines--heuristics)
4. [AI Usage Disclosure (Mandatory)](#ai-usage-disclosure-mandatory)
5. [Trade-offs & Production Considerations](#trade-offs--production-considerations)
   - [Intentional Simplifications](#intentional-simplifications)
   - [Future Improvements](#future-improvements)
   - [Scalability & Concurrency](#scalability--concurrency)
   - [Failure Handling & Resilience](#failure-handling--resilience)
6. [Quickstart & Running Instructions](#quickstart--running-instructions)
   - [Local Development Setup](#local-development-setup)
   - [Running with Docker & Docker Compose](#running-with-docker--docker-compose)
   - [Running Tests & Sample Verification](#running-tests--sample-verification)
7. [Sample API Requests & Responses](#sample-api-requests--responses)
8. [Sample Images Evaluation & Benchmark](#sample-images-evaluation--benchmark)

---

## Overview & Problem Statement

In transit and outdoor media operations (such as auto-rickshaw branding campaigns across Indian metros), field agents capture and upload thousands of vehicle photos daily. Field imagery is prone to real-world edge cases:
- Out-of-focus or moving shots (**Blur**)
- Night or tunnel shots (**Low light**) vs midday reflections (**Glare/Overexposure**)
- Re-uploads or fraudulent identical submissions (**Exact & Perceptual Duplicates**)
- Missing or illegible registration plates (**Indian RTO Format Non-Compliance**)
- Incomplete uploads, phone screenshots, or edited images (**Canvas Corruption & Tampering**)

This system provides a non-blocking asynchronous pipeline that ingests media, executes 6 concurrent computer vision and heuristic checks, computes a unified confidence & quality score, and persists structured audit logs in SQLite.

---

## System Architecture & Design

### Service Flow

```
+------------------+         POST /api/v1/upload         +-----------------------+
|  Field Agent /   | ----------------------------------> |   Express API Layer   |
|  Web Dashboard   | <---------------------------------- | (Multer, UUID, Check) |
+------------------+     202 Accepted + Job ID (15ms)    +-----------------------+
         |                                                           |
         | (Polls /api/v1/jobs/:id/status)                           | 1. Store Media File
         v                                                           | 2. Insert Job ('pending')
+------------------+                                                 | 3. Enqueue Job Payload
| Structured Audit |                                                 v
|  Results (JSON)  |                                     +-----------------------+
|   & Dashboard    | <---------------------------------- |   Async Worker Queue  |
+------------------+     State: 'completed' / 'failed'   | (Concurrency: 3-4)    |
                                                         +-----------------------+
                                                                     |
                                                                     v
                                                         +-----------------------+
                                                         |  6 Pipeline Analyzers |
                                                         | Blur, Light, Dup, OCR,|
                                                         | Tamper, Quality Scorer|
                                                         +-----------------------+
```

### Processing Flow & Analyzers

1. **Ingestion Layer**: `POST /api/v1/upload` accepts `image/jpeg`, `image/png`, or `image/webp`. Generates a deterministic SHA-256 payload checksum and assigns a UUID `job_id`. Returns HTTP `202 Accepted` immediately so field uploaders are never blocked by compute-heavy CV operations.
2. **Job Queue Engine**: Pushes the job to an async worker queue with concurrency limits and exponential backoff retries.
3. **Concurrent Analysis Pipeline**:
   - `BlurAnalyzer`: Calculates Laplacian kernel convolution variance and normalized sharpness (0-100).
   - `LightingAnalyzer`: Calculates grayscale histogram, mean luminance, RMS contrast, and shadow/glare pixel ratios.
   - `DuplicateAnalyzer`: Evaluates exact cryptographic SHA-256 match + 64-bit perceptual difference hash (`dHash`) and average hash (`aHash`) against previous database gallery with Hamming distance.
   - `PlateOcrAnalyzer`: Preprocesses image with dynamic range contrast normalization and runs Tesseract OCR; applies regex validation for standard Indian plates (`^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$`), Bharat series (`^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$`), Delhi RTO patterns, and extracts Task ID & Geotag overlays.
   - `TamperingAnalyzer`: Checks for empty/blank canvas corruption (Shannon entropy & uniform area ratio), aspect ratio screenshot heuristics, and EXIF software tampering.
   - `QualityScorer`: Aggregates metrics into an overall quality score (0-100), categorizes issues into `CRITICAL`, `WARNING`, and `INFO`, and emits a final verdict (`APPROVED`, `FLAGGED_FOR_REVIEW`, or `REJECTED`).
4. **Persistence Layer**: Atomic write of results, execution time, and detected issue records to SQLite using Write-Ahead Logging (WAL).

### Queue Strategy & State Machine

```
              +-------------+
              |   PENDING   |  (Enqueued on upload)
              +-------------+
                     |
                     v
              +-------------+
       +----> | PROCESSING  |  (Worker picks up job)
       |      +-------------+
       |             |
Retry  |      +------+------+
(Max 3)|      |             |
       |      v             v
       |  [Success]      [Error]
       |      |             |
       +------+      (Exceeded Max Retries?)
       |                    |
       |             +------+------+
       |             |             |
  (Wait Delay)      No            Yes
                     |             |
                     v             v
              +-------------+ +-------------+
              |  COMPLETED  | |   FAILED    |
              +-------------+ +-------------+
```

### Major Design Decisions

| Decision | Choice | Rationale |
| :--- | :--- | :--- |
| **Runtime** | Node.js (ESM) + Sharp (libvips) | Sub-millisecond C-level image manipulation without Python GIL bottlenecks or OpenCV compilation hurdles across OS platforms. |
| **Database** | SQLite with WAL Mode | Zero external setup overhead, embedded zero-latency queries, ACID guarantees with Write-Ahead Logging for high concurrency. |
| **Queue Architecture** | In-Process Event Queue with Worker Pool | Self-contained execution without requiring Redis daemon for simple setups, with modular interface ready to plug BullMQ/Redis in multi-node clusters. |
| **OCR Strategy** | Tesseract.js WebAssembly | Pure standalone cross-platform execution with image pre-processing (contrast stretch + sharpening) for vehicle license plates. |

---

## Image Analysis Engines & Heuristics

### 1. Blur Detection (Laplacian Variance)
- Convolves the grayscale image with a $3 \times 3$ discrete Laplacian filter:
  $$\nabla^2 f = \begin{bmatrix} 0 & 1 & 0 \\ 1 & -4 & 1 \\ 0 & 1 & 0 \end{bmatrix}$$
- Computes variance $\sigma^2 = \frac{1}{N} \sum (I_x - \mu)^2$.
- Flags images with $\sigma^2 < 75.0$ as blurry or out of focus.

### 2. Lighting & Exposure Analysis
- Computes 256-bin grayscale histogram and calculates:
  - Mean luminance $\mu_{lum} \in [0, 255]$
  - RMS Contrast $\sigma_{lum} = \sqrt{\frac{1}{N}\sum(I_x - \mu)^2}$
  - Dark shadow ratio ($I_x < 25$) and blown-out glare ratio ($I_x > 235$)
- Flags low light if $\mu_{lum} < 45$ or dark ratio $> 40\%$. Flags overexposure/glare if $\mu_{lum} > 225$ or glare ratio $> 35\%$.

### 3. Duplicate & Perceptual Hash Detection
- **Exact Matches**: SHA-256 cryptographic checksum matching against prior uploads.
- **Perceptual Matches**: Computes 64-bit difference hash (`dHash`):
  1. Downscales image to $9 \times 8$ grayscale.
  2. Compares adjacent pixels horizontally ($8 \times 8 = 64$ comparisons).
  3. Converts 64-bit bitstring to 16-character hex hash.
- Computes Hamming distance $H(d_1, d_2)$ against database gallery. Distances $\le 6$ bits ($>90\%$ similarity) are flagged as near-duplicates.

### 4. Indian License Plate Validation & Field Metadata
- Applies regex to validate 36 Indian State/UT RTO codes and format conventions:
  - `^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$` (e.g., `MH12NW8556`, `TN05BT5754`, `MH12KR1145`)
  - `^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$` (Bharat Series)
  - `^[A-Z]{2}[0-9]{1,2}[A-Z][A-Z]{1,3}[0-9]{4}$` (Delhi RTO category code e.g. `DL3CAB9999`)
- Extracts Field Task ID (`TASK ID: 22FUGV4G2K`), GPS coordinates (`Lat: ... | Long: ...`), and timestamp overlay strings.

### 5. Canvas Integrity & Tampering Heuristics
- **Canvas Corruption / Cropped Blank Area**: Computes Shannon entropy $H = -\sum p_i \log_2(p_i)$ and dominant uniform color ratio. If uniform area $> 45\%$ or $H < 3.5$, flags as invalid/corrupted upload.
- **Screenshot Heuristics**: Evaluates mobile aspect ratios ($9:19.5, 9:20, 9:16$) in combination with missing camera hardware EXIF tags.
- **EXIF Tampering**: Inspects metadata for photo manipulation software signatures (e.g. Photoshop, Canva, Snapseed).

---

## AI Usage Disclosure (Mandatory)

In compliance with the assignment submission requirements, here is the transparent breakdown of AI tool usage:

| Area | What AI Helped With | Where AI Output Was Inaccurate / Suboptimal | How AI Code Was Validated |
| :--- | :--- | :--- | :--- |
| **Laplacian Convolution Setup** | Generating initial Sharp raw pixel matrix buffer convolution boilerplate. | Initial AI draft used an unnormalized image dimension which caused Laplacian variance to swing wildly depending on input resolution. | Added standardized internal working resolution ($800\text{px}$ bounding box) and wrote synthetic unit tests comparing high-frequency vs blurred images. |
| **Indian Plate Regex Patterns** | Drafting initial regular expression sets for Indian RTO license plates. | Initial AI regex assumed strictly 2-letter state + 2-digit number + 2-letter series + 4 digits, failing on 1-digit RTO districts (e.g., `DL 3C`) and relaxed spacing (`TN.05 BT5754`). | Refined regex engine to support optional alphanumeric RTO segments, single-digit padding, delimiter normalization, and full 36 State/UT mapping. |
| **Perceptual Hashing** | Generating standard 64-bit dHash matrix comparisons. | AI provided a bitshift function that had JavaScript 32-bit signed integer overflow on large bitstrings. | Replaced with hex-nibble string conversion and tested bit-by-bit Hamming distance unit tests. |

---

## Trade-offs & Production Considerations

### Intentional Simplifications
1. **In-Process Queue vs Distributed SQS/BullMQ**: Implemented an in-process persistent worker queue to keep the project lightweight, dependency-free, and instantly runnable locally. In high-scale production, this can be swapped with Redis-backed BullMQ or AWS SQS with no changes to the analyzer layer.
2. **Embedded SQLite vs Managed PostgreSQL**: Used SQLite in WAL mode for simplicity and zero-friction setup while maintaining full ACID compliance.

### Future Improvements
1. **YOLOv8 Plate Localizer**: Crop license plate bounding boxes with a lightweight ONNX YOLO model prior to OCR to improve recognition accuracy on angled vehicle shots.
2. **Vector Embeddings for Near-Duplicates**: Use CLIP / ResNet embeddings stored in a vector index (e.g. Milvus / pgvector) for scale-invariant semantic duplicate search.
3. **WebSockets / Server-Sent Events (SSE)**: Push real-time status updates directly to clients instead of client-side HTTP polling.

### Scalability & Concurrency
- Image analysis is CPU-bound. Sharp utilizes libvips multi-threaded SIMD instructions for maximum throughput.
- Worker concurrency is configurable via `QUEUE_CONCURRENCY=4` environment variable.
- In multi-node deployment, worker containers can scale horizontally across a shared S3 bucket and distributed queue.

### Failure Handling & Resilience
- **Exponential Backoff Retries**: Transient failures (e.g. file lock, decoding spike) retry up to 3 times before marking a job `failed`.
- **Atomic State Transitions**: Status updates and metric insertions execute within isolated database transactions.
- **Graceful Shutdown**: Intercepts `SIGTERM` and `SIGINT`, waits for active workers to complete in-flight image analysis, and closes DB handles cleanly.

---

## Quickstart & Running Instructions

### Local Development Setup

#### Prerequisites
- Node.js `v20.0.0` or higher
- npm `v9.0.0` or higher

```bash
# 1. Clone the repository
git clone <your-repo-link>
cd Ginger

# 2. Install dependencies
npm install

# 3. Start the server
npm start
```

Open **`http://localhost:3000`** in your browser to access the interactive web dashboard.

---

### Running with Docker & Docker Compose

```bash
# Build and launch with Docker Compose
docker-compose up --build

# Or run directly with Docker
docker build -t gogig-media-pipeline .
docker run -p 3000:3000 -v $(pwd)/storage:/app/storage gogig-media-pipeline
```

---

### Running Tests & Sample Verification

```bash
# Run complete unit and integration test suite
npm test

# Run automated evaluation on the 3 assignment sample images
npm run test:samples
```

---

## Sample API Requests & Responses

### 1. Upload Field Image
**Request:**
```bash
curl -X POST http://localhost:3000/api/v1/upload \
  -F "image=@sample_images/sample_1.jpg"
```

**Response (HTTP 202 Accepted):**
```json
{
  "success": true,
  "message": "Image uploaded successfully and queued for asynchronous processing",
  "data": {
    "job_id": "8c827219-e0e2-435c-b5c0-e40d01f85696",
    "status": "pending",
    "file_name": "sample_1.jpg",
    "file_size_bytes": 97608,
    "mime_type": "image/jpeg",
    "sha256_hash": "63fcf02d1d07c082877a75043bfba48c59f0f6ea317135e6a03be81a546875ee",
    "dimensions": {
      "width": 562,
      "height": 1000,
      "aspect_ratio": 0.562
    },
    "created_at": "2026-08-18T05:55:16.302Z",
    "links": {
      "status": "/api/v1/jobs/8c827219-e0e2-435c-b5c0-e40d01f85696/status",
      "results": "/api/v1/jobs/8c827219-e0e2-435c-b5c0-e40d01f85696/results",
      "image_url": "/api/v1/media/uuid-image.jpg"
    }
  }
}
```

---

### 2. Poll Job Status
**Request:**
```bash
curl -X GET http://localhost:3000/api/v1/jobs/8c827219-e0e2-435c-b5c0-e40d01f85696/status
```

**Response:**
```json
{
  "success": true,
  "data": {
    "job_id": "8c827219-e0e2-435c-b5c0-e40d01f85696",
    "status": "completed",
    "verdict": "APPROVED",
    "overall_score": 95,
    "risk_level": "LOW",
    "execution_time_ms": 1420.5,
    "created_at": "2026-08-18T05:55:16.302Z",
    "completed_at": "2026-08-18T05:55:17.722Z"
  }
}
```

---

### 3. Fetch Full Structured Analysis Results
**Request:**
```bash
curl -X GET http://localhost:3000/api/v1/jobs/8c827219-e0e2-435c-b5c0-e40d01f85696/results
```

**Response:**
```json
{
  "success": true,
  "data": {
    "job_id": "8c827219-e0e2-435c-b5c0-e40d01f85696",
    "status": "completed",
    "overall_score": 95,
    "verdict": "APPROVED",
    "risk_level": "LOW",
    "execution_time_ms": 1420.5,
    "checks": {
      "blur": {
        "is_blurry": false,
        "laplacian_variance": 968.72,
        "sharpness_score": 100,
        "threshold": 75
      },
      "lighting": {
        "brightness_mean": 118.2,
        "contrast_rms": 52.15,
        "is_low_light": false,
        "is_overexposed": false
      },
      "duplicate": {
        "is_duplicate": false,
        "duplicate_job_id": null,
        "similarity_score": 0.12,
        "dhash": "85861e1280808000"
      },
      "license_plate": {
        "detected": true,
        "plate_number": "MH12NW8556",
        "format_valid": true,
        "state": "Maharashtra",
        "confidence": 0.92,
        "task_id": null,
        "geotag": "PUNE FC ROAD"
      },
      "tampering_and_corruption": {
        "is_screenshot": false,
        "is_corrupted_or_blank": false,
        "uniform_area_ratio": 0.07,
        "entropy": 7.62,
        "exif_present": true
      }
    },
    "detected_issues": []
  }
}
```

---

## Sample Images Evaluation & Benchmark

Here is the breakdown of the pipeline's evaluation on the 3 sample images provided in the assignment:

| Sample | Image Context | Detected License Plate / Metadata | Blur & Lighting | Integrity & Duplication | Final Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Sample 1** | Arena Animation Auto Rickshaw (Pune FC Road) | **`MH12NW8556`** (Maharashtra RTO) | Sharp (Variance: 968.7), Optimal Lighting (Mean: 118.2) | Valid unique canvas | **`APPROVED`** (Score: 90/100, Low Risk) |
| **Sample 2** | Dr. Agarwals Eye Hospital Auto (Chennai) with Field Overlay | **`TN05BT5754`** (Tamil Nadu RTO) + **Task ID: `22FUGV4G2K`** + **GPS: `13.1059115, 80.2514811`** + **Timestamp: `17 Feb 2026 11:22 AM`** | Sharp (Variance: 916.3), Optimal Lighting | Valid camera capture with geotag banner | **`APPROVED`** (Score: 95/100, Low Risk) |
| **Sample 3** | Arena Animation Auto (Campaign duplicate shot) | **`MH12KR1145`** (Maharashtra RTO) | Sharp (Variance: 468.0), Optimal Lighting | Near-match perceptual hash with Sample 1 campaign creative | **`FLAGGED_FOR_REVIEW`** (Score: 75/100, Medium Risk) |
| **Duplicate Test** | Exact re-upload of Sample 1 | `MH12NW8556` | Identical metrics | **Exact SHA-256 Hash Match** to previous Job ID | **`REJECTED`** (Score: 10/100, High Fraud Risk) |
| **Corrupted Test** | 100% Solid Blank Canvas / Cropped Area | No plate detected | Variance: 0.0, Overexposed | **100% Uniform Area Ratio**, Entropy: 0.0 | **`REJECTED`** (Score: 0/100, Critical Corruption) |

---

## Authors & License
- **Candidate Submission**: gOGig Backend + AI Engineering Take-Home Assignment
- **License**: MIT
