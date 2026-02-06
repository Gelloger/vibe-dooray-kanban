# Dooray 댓글 조회 기능 설계

## 개요

Dooray 태스크의 댓글을 태스크 상세 뷰에서 조회할 수 있는 기능을 추가한다.

## 요구사항

- 태스크 상세 뷰에서 "댓글 보기" 버튼 클릭 시 댓글 조회
- 조회만 지원 (작성은 기존 "Dooray에 저장" 기능 또는 Dooray에서 직접)
- 표시 정보: 작성자 이름, 내용, 작성 시간

## 백엔드 API

### 엔드포인트

```
GET /api/dooray/projects/{dooray_project_id}/tasks/{dooray_task_id}/comments
```

### 응답 타입

```typescript
type DoorayComment = {
  id: string;
  author_name: string;
  content: string;
  created_at: string;  // ISO 8601
};

type GetDoorayCommentsResponse = {
  comments: DoorayComment[];
};
```

### Dooray API

```
GET https://api.dooray.com/project/v1/projects/{projectId}/posts/{postId}/logs
```

## 프론트엔드 구조

### 새로 추가할 파일/함수

1. `doorayApi.getComments()` - API 호출 함수
2. `useDoorayComments()` - React Query 훅
3. `DoorayCommentsSection` - 댓글 섹션 컴포넌트

### 컴포넌트 배치

```
TaskCard (펼친 상태)
├── TaskCardHeader
├── 태스크 설명
├── ... 기존 내용 ...
└── DoorayCommentsSection (Dooray 태스크일 때만)
    ├── [댓글 보기] 버튼
    └── (클릭 시) 댓글 목록
```

## UI 상세

### 버튼

- 조건: `task.dooray_task_id` 존재 시만 표시
- 아이콘: `MessageSquare`
- 텍스트: "댓글 보기" ↔ "댓글 접기" 토글

### 상태별 UI

| 상태 | 표시 |
|------|------|
| 로딩 중 | 스피너 + "댓글 불러오는 중..." |
| 댓글 있음 | 댓글 목록 (시간순) |
| 댓글 없음 | "댓글이 없습니다" |
| 에러 | "댓글을 불러올 수 없습니다" + 재시도 버튼 |

### 댓글 아이템

```
┌─────────────────────────────────────┐
│ 홍길동                    2시간 전   │
│ 댓글 내용                            │
└─────────────────────────────────────┘
```

- 작성자: 볼드
- 시간: 상대 시간 (예: "2시간 전")
- 내용: 일반 텍스트
