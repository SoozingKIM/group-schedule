# 인터넷 배포 가이드 (Vercel + Neon)

이 앱은 **`DATABASE_URL` 환경변수가 있으면 자동으로 Postgres를 사용**합니다.
코드를 고칠 필요 없이, 아래 순서대로만 하면 됩니다. (모두 무료 범위)

---

## 1단계 — Neon에서 무료 데이터베이스 만들기

1. https://neon.tech 접속 → 가입(구글 계정 등으로 가능)
2. **Create project** 클릭 → 이름 아무거나, 지역은 가까운 곳(예: Singapore/Tokyo)
3. 생성되면 **Connection string**(연결 문자열)이 보입니다.
   - **"Pooled connection"** 으로 표시된 것을 복사하세요.
   - 형태: `postgresql://사용자:비밀번호@ep-xxxx-pooler.region.aws.neon.tech/dbname?sslmode=require`
4. 이 문자열을 잠시 메모장에 붙여 둡니다. (2단계에서 사용)

> 표는 앱이 처음 실행될 때 자동으로 만들어지므로, 따로 SQL을 입력할 필요가 없습니다.

---

## 2단계 — Vercel에 배포하기

### 방법 ① Vercel CLI (GitHub 없이 바로 배포 — 가장 빠름)

프로젝트 폴더에서:

```bash
npm i -g vercel        # 처음 한 번
vercel login           # 브라우저로 로그인
vercel                 # 질문에 Enter로 진행 → 프리뷰 배포 생성
```

배포가 끝나면 환경변수에 Neon 연결 문자열을 등록하고 운영 배포:

```bash
vercel env add DATABASE_URL production
# 붙여넣기: 1단계에서 복사한 Neon 연결 문자열
vercel --prod          # 운영(공개) 주소로 배포
```

마지막에 출력되는 `https://...vercel.app` 주소가 **공유용 사이트 주소**입니다.

### 방법 ② GitHub 연동 (코드 푸시 시 자동 재배포)

1. 코드를 GitHub 저장소에 올립니다.
2. https://vercel.com → **Add New > Project** → 그 저장소를 Import
3. **Environment Variables** 에 추가:
   - Name: `DATABASE_URL`
   - Value: 1단계에서 복사한 Neon 연결 문자열
4. **Deploy** 클릭

---

## 3단계 — 사용

- 배포된 주소(`https://...vercel.app`)에 접속해 프로젝트를 만듭니다.
- 프로젝트 화면의 **🔗 공유 링크** 버튼으로 주소를 복사해 참여자들에게 전달하면,
  각자 자기 탭을 골라 가능한 시간을 입력할 수 있습니다.

---

## 자주 묻는 점

- **데이터가 안 보여요 / 새로고침하면 사라져요**: `DATABASE_URL` 환경변수가
  설정되지 않은 것입니다. 설정하지 않으면 파일 저장소를 쓰는데, Vercel은 파일이
  유지되지 않습니다. Vercel 프로젝트 설정의 Environment Variables를 확인하세요.
- **환경변수를 바꿨는데 그대로예요**: 환경변수 변경 후 **재배포**(Redeploy)해야 적용됩니다.
- **로컬에서 테스트**: `DATABASE_URL` 없이 `npm run dev` 하면 `data.json` 파일에 저장되어
  계정/DB 없이도 똑같이 동작합니다.
