# TRIET CHIEN Backend

Backend Express cho website hỗ trợ board game TRIET CHIEN.

## Chạy dự án

```bash
npm install
npm run import:cards
npm run dev
```

Mặc định API chạy tại `http://localhost:4000`.

Nếu có MongoDB local, copy `.env.example` thành `.env` và giữ:

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/triet_chien
```

Khi không có `MONGODB_URI`, backend tự chạy bằng bộ nhớ tạm để dev nhanh, nhưng dữ liệu câu đã hỏi sẽ mất khi restart server.

Frontend React nằm trong thư mục `client`.

```bash
cd client
npm install
npm run dev
```

Hoặc chạy từ thư mục gốc:

```bash
npm run client:dev
```

## Scripts

- `npm run import:cards`: đọc 4 file DOCX batch lá tình huống và sinh `data/cards.json`.
- `npm run dev`: chạy backend với `node --watch`.
- `npm run client:dev`: chạy frontend Vite.
- `npm run client:build`: build frontend.
- `npm start`: chạy backend production đơn giản.
- `npm test`: chạy test bằng Node test runner.

## API chính

- `GET /health`
- `GET /api/events`
- `GET /api/skills`
- `GET /api/cards`
- `GET /api/cards?includeQuestions=true`
- `GET /api/cards/:code`
- `GET /api/cards/:code/questions/:difficulty`
- `POST /api/answers/check`
- `POST /api/matches`
- `GET /api/matches/:matchId`
- `POST /api/matches/:matchId/questions/reveal`
- `POST /api/matches/:matchId/skills/apply`
- `POST /api/matches/:matchId/events/random`
- `POST /api/matches/:matchId/score`
- `POST /api/matches/:matchId/answers`

## Ví dụ payload

Tạo trận:

```json
{
  "playerNames": ["An", "Binh", "Chi"],
  "scopeId": "MLN111-2026"
}
```

`scopeId` là mã lớp/đợt chơi. Các câu đã mở trong cùng `scopeId` sẽ không được hiển thị lại ở những trận sau.

Chấm đáp án:

```json
{
  "cardCode": "TH01",
  "difficulty": "easy",
  "answer": "B"
}
```

Gửi câu trả lời trong trận:

```json
{
  "playerId": "PLAYER_ID",
  "cardCode": "TH01",
  "difficulty": "easy",
  "answer": "B"
}
```

Với câu tự luận/tình huống, API trả `autoGradable: false` kèm gợi ý đáp án để GM/MC chấm.

Sau khi một câu trả lời được ghi nhận, trận sẽ có `pendingEvent: true`. Gọi
`POST /api/matches/:matchId/events/random` để quay 1 lá biến cố ngẫu nhiên và ghi vào nhật ký trận.

Áp dụng kỹ năng:

```json
{
  "playerId": "PLAYER_ID",
  "targetPlayerId": "TARGET_PLAYER_ID",
  "skillCode": "KN02",
  "manualDelta": 0,
  "targetDelta": 0,
  "note": "MC xác nhận dùng lá hợp lệ"
}
```

Các kỹ năng có điểm rõ ràng sẽ tự động đổi điểm. Các kỹ năng phức tạp dùng `manualDelta` và
`targetDelta` để MC áp dụng theo tình huống.
