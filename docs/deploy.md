# 인터넷에 공개하기

무료 서버 한 대에 Plandit 전체를 올리고, 무료 주소와 자물쇠(HTTPS)까지 붙이는 방법이에요. 비용은 0원이에요(Oracle 무료 한도 안).
처음 한 번은 30분~1시간쯤 걸려요. 대부분 복사해서 붙여 넣기예요.

## 전체 그림

- **서버**: Oracle Cloud의 평생 무료 서버 한 대(ARM 4코어·24GB 중 일부).
- **주소**: DuckDNS의 무료 주소(`내이름.duckdns.org`).
- **서버 안**: 모든 프로그램(화면·API·워커·모의 결제/문자 서버·DB·Redis)이 도커(프로그램을 상자에 담아 어디서나 똑같이 실행해 주는 도구)로 돌아가요. 밖에서 들어오는 문은 **Caddy 하나(80·443번)** 뿐이고, Caddy가 자물쇠 인증서를 알아서 받고 갱신해요.
- **밖에서 열리는 화면**: `/`(웹앱), `/pg/pay/…`(모의 결제 화면), `/inbox`(가상 문자함), `/v1/…`(공개 API와 MCP 서버 — API 키가 있어야 하고 키마다 요청 수 제한). 그 밖의 API·웹훅·모의 서버 관리 화면은 서버 안에서만 오가요.
- 결제·문자는 전부 모의 서버라 실제 돈이 나가거나 문자가 가지 않아요.
- 서버가 재부팅되면 전부 저절로 다시 떠요. 데이터(DB)는 재부팅해도 남아요.

관련 파일: `Dockerfile`, `docker-compose.prod.yml`, `deploy/Caddyfile`, `deploy/*.sh`, `.github/workflows/ci.yml`.

## 준비물

- 신용카드 또는 체크카드: Oracle 가입 때 본인 확인용이에요. 무료 한도 안에서는 청구되지 않아요.
- GitHub 또는 구글 계정: DuckDNS 로그인용이에요.
- 컴퓨터의 터미널: 맥은 "터미널" 앱, 윈도우는 "PowerShell"이에요.

> Oracle 화면은 한국어로 볼 수 있지만 버튼 이름이 영어로 나올 때가 있어서, 아래에 영어 이름을 괄호로 같이 적었어요.

## 1. Oracle Cloud 가입

1. https://www.oracle.com/kr/cloud/free/ 에서 "무료로 시작하기"를 눌러요.
2. **홈 리전**(서버가 있을 지역)은 나중에 못 바꿔요. 한국이면 "South Korea Central (Seoul)"이나 "South Korea North (Chuncheon)" 중 하나를 골라요.
3. 카드 확인까지 마치면 콘솔(관리 화면)에 들어가져요. 계정이 준비되는 데 몇 분 걸릴 수 있어요.

## 2. 서버 만들기

1. 왼쪽 위 메뉴 → **컴퓨트(Compute)** → **인스턴스(Instances)** → **인스턴스 생성(Create instance)**.
2. 이름: `plandit`
3. **이미지와 모양(Image and shape)**
   - 이미지 변경(Change image) → **Ubuntu** → `Canonical Ubuntu 24.04`
   - 모양 변경(Change shape) → **Ampere** → `VM.Standard.A1.Flex` → OCPU **2**, 메모리 **12GB**
   - 기본으로 골라져 있는 1GB짜리 작은 서버(`VM.Standard.E2.1.Micro`)는 화면을 만들다 메모리가 모자라서 안 돼요.
4. **네트워킹(Networking)**: "새 가상 클라우드 네트워크 생성" 그대로 두고, **공용 IPv4 주소 할당(Assign a public IPv4 address)** 이 켜져 있는지 봐요.
5. **SSH 키 추가(Add SSH keys)**: "키 쌍 생성" 그대로 두고 **개인 키 저장(Save private key)** 을 눌러 파일을 받아요. 이 파일이 서버 열쇠예요. 잃어버리면 서버에 못 들어가요.
6. 나머지는 그대로 두고 **생성(Create)**.
7. 상태가 **실행 중(Running)** 이 되면 화면의 **공용 IP 주소(Public IP address)** 를 적어 둬요(예: `140.238.1.2`).

"용량 부족(Out of capacity)" 오류가 나면 무료 서버 자리가 잠시 없다는 뜻이에요. 몇 시간 뒤나 다음 날 다시 눌러 보세요. OCPU 1·메모리 6GB로 줄이면 자리가 더 잘 나고, 그래도 돌아가요.

## 3. 문 열기 ① Oracle 쪽 (80·443번)

서버 앞에 Oracle 방화벽이 있어서, 웹 접속용 문(80·443번)을 열어 줘야 해요. 서버 접속용 22번은 처음부터 열려 있어요.

1. 인스턴스 상세 화면 → **서브넷(Subnet)** 링크 → **보안 목록(Security Lists)** → `Default Security List for …`
2. **수신 규칙 추가(Add Ingress Rules)**
   - 소스 CIDR(Source CIDR): `0.0.0.0/0`
   - IP 프로토콜: `TCP`
   - 대상 포트 범위(Destination Port Range): `80,443`
3. **수신 규칙 추가**를 눌러 저장해요.

## 4. 무료 주소 만들기 (DuckDNS)

1. https://www.duckdns.org 에 GitHub나 구글로 로그인해요.
2. **sub domain** 칸에 원하는 이름(예: `myplandit`)을 넣고 **add domain**.
3. 그 줄의 **current ip** 칸에 2번에서 적은 공용 IP를 넣고 **update ip**.

이제 `myplandit.duckdns.org`가 내 서버를 가리켜요. 아래 명령의 `myplandit`은 전부 내가 고른 이름으로 바꿔 넣으세요.

## 5. 서버에 들어가서 준비하기 (한 번만)

### 접속

2번에서 받은 열쇠 파일이 "다운로드" 폴더에 있다고 할 때:

```bash
# 맥: 열쇠 파일을 나만 읽게 바꾼 뒤 접속
chmod 600 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@공용IP
```

```powershell
# 윈도우 PowerShell (파일 이름은 실제 이름으로)
ssh -i $HOME\Downloads\ssh-key-2026-09-30.key ubuntu@공용IP
```

처음에 `Are you sure you want to continue connecting?`라고 물으면 `yes`를 입력해요. 줄 앞이 `ubuntu@plandit:~$`로 바뀌면 서버 안이에요.

### 서버 안 방화벽 열기와 도커 설치

아래를 통째로 붙여 넣어요. 방화벽을 **도커 설치 전에** 열어야 해요(도커가 만든 규칙까지 저장되면 재부팅 때 꼬여요).

```bash
# 서버 안 방화벽에서 80·443번 열고 저장
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save

# 도커 설치, 지금 사용자가 sudo 없이 도커를 쓰게 하기
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit
```

마지막 `exit`로 접속이 끊겨요. **위의 `ssh` 명령으로 다시 접속**해요. 다시 들어와야 도커 권한이 적용돼요.

## 6. 코드 받고 띄우기

```bash
git clone https://github.com/seommin/plandit.git
cd plandit
deploy/init-env.sh myplandit.duckdns.org   # 비밀번호·비밀 키를 무작위로 만들어 .env.production에 적어요
deploy/deploy.sh                           # 처음엔 10~20분 걸려요
deploy/seed-demo.sh                        # 데모 계정 만들기
```

- `.env.production`에는 DB 비밀번호와 로그인 비밀 키가 들어 있어요. GitHub에는 올라가지 않아요. **지우지 마세요.** 지우고 다시 만들면 기존 DB에 못 들어가요.
- `deploy.sh`가 끝나면 표가 나와요. `migrate`는 `Exited (0)`(할 일 끝내고 종료)이 정상이고, 나머지는 `Up`이면 돼요.

## 7. 휴대폰으로 확인

1. 휴대폰 와이파이를 끄고(LTE·5G로) `https://myplandit.duckdns.org`를 열어요. 첫 접속은 자물쇠 인증서를 받느라 수십 초 걸릴 수 있어요.
2. 로그인 화면의 **데모 계정으로 둘러보기**를 눌러요.
3. 아래 탭 **크레딧** → **충전하기** → **10,000원** → **10,000원 결제하기** → 모의 결제 화면에서 **결제 승인** → "1,000 크레딧이 들어왔어요"가 나오면 성공이에요.
4. 재부팅 확인: 서버에서 `sudo reboot` → 2~3분 뒤 휴대폰에서 다시 열어 봐요. 방금 충전한 크레딧이 그대로 있어야 해요.

데모 계정: `demo@plandit.dev` / `plandit-demo-1234`(팀원 계정 `teammate@plandit.dev`도 같은 비밀번호). 주소가 정해졌으면 README 맨 위에 적어 두면 좋아요.

## 8. (선택) main에 합치면 자동으로 배포

설정해 두면, main 브랜치에 코드가 들어갈 때마다 GitHub가 코드 검사(형식·타입·테스트)를 돌리고, 통과하면 서버에 들어가 `deploy/deploy.sh`를 실행해요.

1. 서버에서:
   ```bash
   cd ~/plandit && deploy/github-secrets.sh
   ```
   이름 네 개와 각각의 값이 나와요. 이때 만든 열쇠는 이 서버에서 **배포 명령만** 실행할 수 있어요. 다른 명령은 막혀요.
2. GitHub 저장소 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. 네 개를 하나씩 넣어요(Name에 이름, Secret에 값).
   - `DEPLOY_HOST`
   - `DEPLOY_USER`
   - `DEPLOY_KNOWN_HOSTS`
   - `DEPLOY_SSH_KEY`: `-----BEGIN`부터 `-----END … KEY-----`까지 전부
3. 확인: 저장소의 **Actions** 탭 → **CI** → 가장 최근 main 실행 → **Re-run all jobs**. `deploy` 단계가 초록색이면 돼요.

네 개를 넣기 전에는 `deploy` 단계가 "서버 설정 없음"이라고만 남기고 넘어가요(실패가 아니에요).

## 9. (선택) 매일 새벽 4시에 데모 초기화

공개 데모라면 누가 뭘 만들어 놓든 매일 처음 상태로 돌아가게 할 수 있어요. **모든 데이터가 지워지니** 내가 실제로 쓰는 서버에서는 하지 마세요.

```bash
crontab -e     # 처음이면 편집기를 물어요 → 1 (nano)
```

맨 아래에 이 줄을 붙여 넣고 저장(Ctrl+O, Enter)·종료(Ctrl+X)해요.

```
0 19 * * * /home/ubuntu/plandit/deploy/reset-demo.sh >> /home/ubuntu/reset-demo.log 2>&1
```

서버 시계는 세계 표준시(UTC)라 19시가 한국 새벽 4시예요. 바로 해 보려면 `deploy/reset-demo.sh`를 직접 실행하면 돼요.

## 평소에 쓰는 명령

서버에서 `cd ~/plandit` 한 뒤:

| 하고 싶은 것 | 명령 |
| --- | --- |
| 최신 코드로 다시 띄우기(자동 배포를 안 켰을 때) | `deploy/deploy.sh` |
| 상태 보기 | `docker compose --env-file .env.production -f docker-compose.prod.yml ps` |
| 기록(로그) 보기 | `docker compose --env-file .env.production -f docker-compose.prod.yml logs -f --tail 100 api` (`api` 대신 `web`, `worker`, `mocks`, `caddy`) |
| DB 백업 | `docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres pg_dump -U plandit plandit \| gzip > ~/plandit-$(date +%F).sql.gz` |

명령이 길면 한 번만 `echo "alias pc='docker compose --env-file ~/plandit/.env.production -f ~/plandit/docker-compose.prod.yml'" >> ~/.bashrc && source ~/.bashrc` 해 두고, 그다음부터 `pc ps`, `pc logs -f api`처럼 줄여 써요.

## AI 연결은 연습용 그대로 두세요

공개 서버는 AI 여행 일정을 **연습용(모의 AI)** 으로 둬요(`.env.production`의 `LLM_PROVIDER=mock`). 모의 결제로 누구나 크레딧을 공짜로 충전할 수 있어서, 여기에 진짜 AI 키를 넣으면 모르는 사람이 **내 돈으로** AI를 계속 부를 수 있어요.

진짜 AI 일정을 보여 주고 싶으면, 나만 쓰는 서버에서만 `.env.production`에 `LLM_PROVIDER=anthropic`과 `ANTHROPIC_API_KEY=발급받은키`를 적고 `deploy/deploy.sh`를 다시 실행해요. 이때는 Anthropic 콘솔에서 월 사용 한도도 꼭 걸어 두세요.

## 알아 두기

- **무료 한도**: ARM 서버는 계정 전체에서 4코어·24GB, 저장 공간은 합계 200GB까지 무료예요. 이 안내대로면 절반만 써요.
- **놀고 있는 무료 서버 회수**: Oracle은 무료 계정에서 7일 동안 CPU·네트워크·메모리를 거의 안 쓰는 서버를 회수할 수 있다고 안내하고 있어요. 회수 안내 메일이 오면 확인해 주세요. 종량제(Pay As You Go) 계정으로 바꾸면 회수 대상에서 빠지지만, 무료 한도를 넘는 만큼은 요금이 나가니 서버 크기를 늘리지 마세요.
- **공용 IP가 바뀌면**(서버를 지우고 다시 만들었을 때 등) DuckDNS의 current ip만 새 값으로 바꾸면 돼요.

## 문제가 생기면

표의 `pc`는 위 "평소에 쓰는 명령"에서 만든 줄임말이에요.

| 증상 | 확인할 것 |
| --- | --- |
| 주소를 열면 한참 돌다 "연결할 수 없음" | 3번(Oracle 수신 규칙 80·443), 5번 방화벽 명령, DuckDNS의 IP가 서버 공용 IP와 같은지. 서버에서 `getent hosts myplandit.duckdns.org`로 IP 확인 |
| "안전하지 않은 연결", 인증서 오류 | `pc logs caddy`에 인증서 발급 실패가 있는지. 대개 80·443이 막혔거나 DuckDNS IP가 틀려서예요. 고친 뒤 `pc restart caddy` |
| 로그인하면 다시 로그인 화면으로 | `.env.production`의 `DOMAIN`이 실제 주소와 같은지. 고쳤으면 `deploy/deploy.sh` |
| 5번 방화벽 명령에서 `Index of insertion too big` 또는 `netfilter-persistent: command not found` | 서버에 Oracle 기본 방화벽 규칙이 없다는 뜻이라 이 단계는 건너뛰어도 돼요 |
| `permission denied … docker.sock` | 5번의 `exit` 후 다시 접속했는지 |
| `deploy.sh` 중간에 멈추거나 `Killed` | 메모리 부족. 서버가 A1(메모리 6GB 이상)인지 |
| 윈도우에서 `UNPROTECTED PRIVATE KEY FILE` | PowerShell에서 `icacls 열쇠파일 /inheritance:r /grant:r "$($env:USERNAME):(R)"` 후 다시 접속 |
| 데모 계정 버튼이 없어요 | `.env.production`의 `NEXT_PUBLIC_DEMO_EMAIL`이 채워져 있는지. 바꿨으면 `deploy/deploy.sh`(화면을 다시 만들어야 적용돼요) |

그 밖의 장애 대응은 [runbook.md](runbook.md)를 보세요.
