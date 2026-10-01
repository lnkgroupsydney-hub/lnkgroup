# 다른 기기에서 작업 이어가기

이 프로젝트의 GitHub 저장소는 [lnkgroupsydney-hub/lnkgroup](https://github.com/lnkgroupsydney-hub/lnkgroup)이다. 각 기기에 별도로 복제하고 GitHub를 통해 변경 사항을 주고받는다. Mac에서는 OneDrive나 iCloud 동기화 폴더 밖의 `~/Developer/lnkgroup` 같은 경로를 사용한다.

## 현재 프로젝트 상태

현재 저장소에는 개발 계획서, 클라이언트 제안서, 화면 시안, 문서 생성·검증 도구, Codex 프로젝트 설정이 있다. 실행 가능한 웹앱과 `package.json`은 아직 없다. 문서를 읽고 계획 작업을 이어가는 데 Node.js·Docker·DB 설정은 필요하지 않다. 실제 앱 개발 환경은 [기술 구조 계획](plans/03-architecture-and-deployment.md)을 기준으로 구현 착수 때 구성한다.

## 맥북에서 최초로 내려받기

Git이 설치되어 있는지 터미널에서 `git --version`으로 확인한다. 없다면 macOS의 개발자 도구 설치 안내에 따라 Git을 설치한다. 비공개 저장소는 접근 권한이 있는 GitHub 계정으로 인증해야 한다. HTTPS 인증에는 GitHub Desktop 또는 GitHub CLI의 로그인 기능을 사용할 수 있다. 계정 비밀번호나 토큰을 프로젝트 파일에 저장하지 않는다.

터미널에서 다음을 실행한다.

```sh
mkdir -p ~/Developer
cd ~/Developer
git clone https://github.com/lnkgroupsydney-hub/lnkgroup.git
cd lnkgroup
git status
```

SSH 키를 GitHub 계정에 등록한 기기는 다음 주소로 복제할 수도 있다.

```sh
git clone git@github.com:lnkgroupsydney-hub/lnkgroup.git
```

터미널 대신 GitHub Desktop에서 `File → Clone Repository`를 선택하고 같은 저장소를 복제해도 된다. 이후 Codex에서 복제된 `lnkgroup` 폴더를 프로젝트로 연다. ZIP 다운로드는 Git 이력이 포함되지 않으므로 계속 개발할 때는 Clone을 사용한다.

새 Codex 작업의 첫 메시지 예시:

```text
다른 기기에서 작업하던 L&K Group 프로젝트를 이어서 진행해.
README.md, AGENTS.md, docs/plans, .codex/config.toml을 먼저 읽고
기존 결정과 작업 규칙을 유지해. 내가 지정하는 다음 작업을 이 기준으로 진행해.
```

프로젝트의 `AGENTS.md`와 `.codex/config.toml`은 Git에 포함된다. 앱 로그인, 설치한 플러그인, 사용자 전역 설정, 대화 기록은 이 저장소의 파일이 아니므로 필요한 항목은 새 기기에서 별도로 설정한다. 모델 선택과 적용 범위는 [모델과 개발 운영](plans/13-ai-development-workflow.md)을 따른다.

## 기기를 바꿀 때마다

작업 시작 전, 저장소 폴더에서 실행한다.

```sh
git status
git pull --ff-only
```

작업 종료 후 변경 내용을 확인하고 저장한다.

```sh
git status
git diff
git add .
git diff --cached --stat
git commit -m "Describe the changes made"
git push
```

`Describe the changes made`는 실제 변경 내용을 설명하는 메시지로 바꾼다. 변경이 없으면 커밋할 필요가 없다. 다음 기기로 이동하기 전에 push가 성공했는지 확인한다. `pull --ff-only`가 실패하거나 충돌이 생기면 오류와 `git status` 결과를 Codex에 전달해 해결한다. 원격 이력을 덮어쓰는 force push는 사용하지 않는다.

## 저장되는 파일과 제외되는 파일

계획서·시안·최종 Word·기존 전달용 ZIP·문서 도구는 저장한다. `deliverables/LK_Group_Planning_Package.zip`은 만들어진 시점의 전달본이며 현재 Git 파일의 변경을 자동 반영하지 않는다. 최신 개발 기준은 저장소의 원본 파일이다.

`.gitignore`는 임시 QA 결과(`tmp/`), 의존성, 빌드 결과, `.env`와 로컬 인증 파일 등을 제외한다. `.env.example`에는 실제 비밀값 없이 필요한 변수명과 설명만 넣는다. 고객 사진이나 실제 개인정보는 저장소에 추가하지 않고 비공개 저장소·스토리지에서 관리한다.

## 기존 문서 도구의 실행 조건

- `tools/build_client_doc.py`는 Python과 `python-docx`가 필요하다. 문서 폰트는 `Malgun Gothic`으로 지정되어 있어 맥에서 Word를 열거나 렌더링할 때 폰트 설치 여부와 대체 폰트에 따라 배치가 달라질 수 있다.
- `tools/verify_documents.py`는 Python 3.11 이상, `pypdf`, `pdf2image`, Poppler 및 미리 내보낸 `tmp/docx-qa/client-proposal.pdf`가 필요하다. 이 PDF는 Git에서 제외된다. 현재 스크립트의 Poppler 경로는 Windows 전용이므로 맥에서 실행하기 전에 설치 경로에 맞게 조정해야 한다.
- 맥에서 문서 도구를 실제 실행해 검증한 상태는 아니다. 기존 검증 범위는 [문서 검증 기록](document-validation.md)에 적혀 있다.
