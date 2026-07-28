# Storm AI

Storm AI is an AI image and video creation workspace where users create, inspect, and download generated visual assets.

## Language

**高清放大器**:
A temporary workspace tool that takes one user-provided image and produces one AI-upscaled image.
_Avoid_: 生图, 改图, 历史项目

**AI 超分放大**:
A content-preserving image enhancement that increases resolution and perceived detail without intentionally changing the source image.
_Avoid_: 普通缩放, 重绘增强

**临时结果图**:
An externally returned output image that is previewed and downloaded in the current session without being saved to project history or site storage.
_Avoid_: 生成历史, 画布素材

**在途图片任务**:
An image generation job whose status is `submitted` or `processing` and which therefore occupies one account-level active generation slot.
_Avoid_: completed, partial_completed, failed, video task

**生成限制配置**:
The global image-task limits saved by an administrator. An enabled active-task limit may never be saved below any account's current number of **在途图片任务**.
_Avoid_: terminating existing jobs, retroactive refunds, per-account overrides

## Relationships

- A **高清放大器** performs **AI 超分放大** on exactly one source image.
- A **高清放大器** produces exactly one **临时结果图** in the V1 flow.
- A **临时结果图** is not a history project and is not a canvas asset.
- A **在途图片任务** releases its active slot as soon as it becomes `completed`, `partial_completed`, or `failed`.
- A successfully created image job counts toward the Beijing-time daily generation limit even if it later becomes `failed`.
- Saving **生成限制配置** takes an exclusive lock on the settings row; creating an image job takes a shared lock on that same row before checking limits and inserting the job.
- Disabling **生成限制配置** never terminates or refunds existing jobs. When enabled, equality with the proposed active limit is allowed; only current usage above it blocks the save.

## Example Dialogue

> **Dev:** "Should the 高清放大器 create a new history project?"
> **Domain expert:** "No — V1 returns a 临时结果图 only, so the user should download it before leaving the page."

## Flagged Ambiguities

- "高清放大" was resolved to mean **AI 超分放大**, not ordinary pixel interpolation or generative redraw.
