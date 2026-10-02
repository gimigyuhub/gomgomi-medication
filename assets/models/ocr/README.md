# OCR 모델

브라우저에서 onnxruntime-web으로 실행하는 PaddleOCR PP-OCRv5 모델입니다(`src/ocr-paddle.js`).

| 파일 | 역할 | 크기 | SHA-256 |
|---|---|---|---|
| `ch_PP-OCRv5_det_mobile.onnx` | 글자 영역 검출 | 4.8MB | `4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae` |
| `korean_PP-OCRv5_rec_mobile.onnx` | 한국어 글자 인식 | 13.5MB | `cd6e2ea50f6943ca7271eb8c56a877a5a90720b7047fe9c41a2e541a25773c9b` |
| `korean_PP-OCRv5_dict.txt` | 인식 모델 글자 목록(11,945자, 모델 메타데이터에서 추출) | 47KB | |

- 원본 모델: [PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) PP-OCRv5, Apache License 2.0
- ONNX 변환: [RapidAI/RapidOCR](https://github.com/RapidAI/RapidOCR) v3.9.2 배포본, Apache License 2.0
