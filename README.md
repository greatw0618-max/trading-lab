# 매매연구소

RSI 과매도 분할매수 매매법을 엘리엇 파동·ICT·와이코프 관점과 함께 점검하고, 하이퍼리퀴드 고래 포지션을 추적하는 대시보드입니다.

## GitHub Pages에 올리기 (처음 한 번)

1. **저장소 만들기**: https://github.com/new 에서 이름(예: `trading-lab`)을 넣고 **Public**을 선택한 뒤 **Create repository**를 누릅니다.
2. **파일 올리기**: 새 저장소 화면의 **uploading an existing file** 링크를 누르고, 이 폴더 안의 파일과 폴더(`index.html`, `css`, `js`, `data`, `scripts`, `.github`, `README.md`)를 전부 끌어다 놓은 뒤 **Commit changes**를 누릅니다.
   - `.github` 폴더가 빠지면 데이터 자동 갱신이 안 됩니다. 올린 뒤 저장소에 `.github/workflows/update-data.yml`이 보이는지 확인하세요.
3. **사이트 켜기**: 저장소의 **Settings → Pages**에서 Source를 **Deploy from a branch**, Branch를 **main / (root)**로 고르고 **Save**를 누릅니다. 1~2분 뒤 `https://<내 아이디>.github.io/trading-lab/` 주소로 열립니다.
4. **자동 갱신 권한**: **Settings → Actions → General → Workflow permissions**에서 **Read and write permissions**를 고르고 **Save**를 누릅니다.
5. **첫 실행 확인**: **Actions** 탭 → **Update data** → **Run workflow**를 누릅니다. 초록색 체크가 뜨면 성공입니다.

이후에는 미국 장중 30분마다, 그리고 매일 한 번 데이터가 자동으로 갱신됩니다.

## 데이터

| 화면 | 출처 | 갱신 |
|---|---|---|
| SOXL·KORU 실시간 가격, 15분봉 신호 | 하이퍼리퀴드 `xyz:SOXL`, `xyz:KORU` (24시간 거래) | 브라우저에서 15초마다 |
| 정규장 15분·1시간·일봉, 기초지수 SOXX·EWY | 야후 파이낸스 → `data/*.json` | GitHub Actions, 장중 30분마다 |
| 고래 지갑·상위 트레이더 포지션 | 하이퍼리퀴드 공개 API | 브라우저에서 30초마다 |
| 리더보드 | stats-data.hyperliquid.xyz → `data/leaderboard.json` | GitHub Actions |

야후 15분봉은 최근 60일치만 제공되지만, 갱신할 때마다 기존 파일에 이어 붙이므로 시간이 지날수록 기록이 쌓입니다.

## 주의

엘리엇 파동·와이코프·ICT 판독은 정해진 계산 규칙으로 만든 추정이고, "예상 투자 결과"의 확률은 과거 비슷한 상황을 센 통계일 뿐 미래를 보장하지 않습니다. 투자 조언이 아닙니다.
