# Báo cáo rà soát đối chiếu Code – Word – Slide (Phần việc của Nguyễn Hoài Nam)

- **Người thực hiện:** Nguyễn Hoài Nam (`NHNam1209`, MSSV: `2312694`)
- **Ref Issue:** `#29` (`[Sprint 5] N – Final report and slides`)
- **Nguồn đối chiếu:**
  1. **Mã nguồn & tài liệu repo:** `https://github.com/alphatrann/outline` (nhánh `main`, commit `aac000c`, base Outline cố định `05ef55e`)
  2. **File Word:** `BaoCao_KiemThu_Outline_K16_CuoiKy.docx` (46 trang vật lý; Mục lục đánh số trang nội dung 1–38)
  3. **Slide thuyết trình:** `https://claude.ai/artifact/L4ZkXLDzBF33xSCiwBDRTE#slide-a720c2bb3060` (16 slide)

---

## Tóm tắt nhanh các phát hiện nghiêm trọng nhất

| Mức độ | Đối tượng | Tóm tắt sai sót / thiếu sót |
| --- | --- | --- |
| **Cao** | Word (Phụ lục A.5.2), Bảng 3.4, Code | **A.5.2 (`should scope search results by shareId`)**: Word mô tả test gọi `documents.search` kèm `shareId` và chỉ trả về tài liệu trong collection X. Thực tế trong `documents.integration.test.ts:88-145`, test tạo share nhưng **không lấy `shareId`**, gọi `documents.search` bằng user đăng nhập **không truyền `shareId`** và **không assert loại trừ tài liệu ngoài collection X**. Mâu thuẫn với Mục 6.3, 6.4.4 và Slide 6 ("nhánh public của search chưa được kiểm thử"). |
| **Cao** | Word (Phụ lục A.3.5), Code | **A.3.5 (`should reorder siblings to the requested index`)**: Word ghi thứ tự sau khi move `A` với `index: 2` là **`B, C, A`**. Code thực tế (`documents.integration.test.ts:446-453`) assert `[y, x, z]` tức **`B, A, C`** (trùng khớp với `ISSUE26_INTEGRATION_TESTS.html` #26: `[second, first, third]`). |
| **Cao** | Word (Bảng 6.3, Mục 6.4.2), Slide 7, Repo | **Số liệu mốc `45 test` trong Bảng 6.3 & Slide 7**: (1) Giá trị `46,42%` dòng và `43,86%` nhánh được đặt ở cột `45 test`, nhưng trong lịch sử repo (commit `3921004`, PR #43) số liệu này đo trên **49 test**. (2) Con số `30,42%` (`160/526` killed, `216` uncovered = `41%`) không có dấu vết trong `ISSUE26_TEST_VALIDITY_REPORT.html` hay commit/PR nào; mốc "Before" lưu trong repo là `36,12%` (`190/526`, `177` uncovered) ở bộ **53 test** (commit `03f4337`). |
| **Cao** | Word (Bảng 6.2), Slide 6, Repo | **Bảng 6.2 thiếu tổng dòng ngoài handler & Slide 6 bỏ nhóm `Chưa nhắm tới`**: Tổng 7 hàng trong Bảng 6.2 là `832 / 1309` (`63,56%`), lệch với `845 / 1327` (`63,67%`) nêu ngay phía trên do thiếu `13 / 18` dòng code top-level ngoài các handler. Trên **Slide 6**, biểu đồ bỏ luôn cột `Chưa nhắm tới (7,3%)` khiến toàn bộ 6 cột đều từ `65,5%` đến `98,6%` nhưng tổng lại ghi `63,7%` (gây khó hiểu ngay khi trình chiếu). |
| **Trung bình** | Word (Mục 6.6.4), Slide 11, Code | **Hai hành vi permission cần xác nhận chưa chính xác hoàn toàn so với code**: (1) Code không cho `pin` mà là **`pinToHome`** (`policies/document.ts:174-182`) thiếu check đọc; và Slide 11 nói Team admin "không đọc được collection đó" là sai với `policies/collection.ts:38-40` (Team admin **đọc được** collection riêng tư, chỉ không đọc được *document* bên trong qua `readDocument`). (2) Guest có membership Admin chỉ `export` được collection khi team bật `TeamPreference.ViewersCanExport` (`policies/collection.ts:57-65, 206-216`), không phải luôn luôn như Word/Slide ghi. |
| **Trung bình** | Word (Mục 3.2.2 vs 7.2), Slide 13 vs 15, Code | **Mâu thuẫn về chờ cố định vs polling**: Mục 3.2.2, 6.8 và Slide 13 khẳng định test chờ bằng polling có thời hạn, không dùng chờ cố định; nhưng Mục 7.2 và Slide 15 lại viết *"Thay việc chờ cố định bằng tín hiệu hoàn thành"*. Trong code `revisions.integration.test.ts:117-153`, test `A.4.1`/`A.4.4` dùng polling (`waitForLatestRevision`) còn `A.4.2`/`A.4.3` vẫn có `setTimeout(2000/3000)` cố định. |

---

## 1. Rà soát Chương 6–7 trong Word so với Báo cáo Coverage, Mutation, PR & Commit

### 1.1. Bảng 6.1 – Kết quả chạy trên máy phát triển, máy sạch và CI (Mục 6.1 & 6.2)

| Hạng mục đối chiếu | Word (Bảng 6.1, Mục 6.1–6.2) | Thực tế trong Repo / PR / CI | Đánh giá |
| --- | --- | --- | --- |
| macOS (arm64) | Node.js `24.21.0`, Docker `29.5.2`, `215/215` đạt `5/5`, `46 giây – 1 phút 12 giây` | Không có file HTML báo cáo riêng cho macOS trong `docs/` (file chỉ ghi trong `ISSUE26_ANOMALY_REPORT.html` ở mốc cũ `45 test`, macOS 27.0, Node `v24.21.0`, Docker `29.5.2`, ~31.5–32.2s). Số `215/215` và `46s – 1m12s` là từ máy tác giả `alphatrann` chưa commit log vào repo. | Cần chú thích rõ log local nằm ngoài repo (`logs/` bị git-ignore). |
| Windows 11 Pro (máy sạch) | Node.js `24.18.0`, Docker `29.6.2`, `215/215` đạt `5/5`, `1 phút 23 giây – 1 phút 31 giây` | Khớp 100% với `docs/ISSUE24_CLEAN_MACHINE_REPORT.html` (PR #50, commit `25fb75e`, chạy trên commit `586624f8d`, Vitest `80.86s – 88.97s`, wall time `01:23 – 01:31`). | **Khớp**. |
| Windows 11 Home (máy sạch) | Node.js `26.13.1`, Docker `29.8.0`, `215/215` đạt `5/5`, `1 phút 51 giây – 5 phút 20 giây` | Khớp với `docs/ISSUE24_CLEAN_MACHINE_REPORT_DinhHieu.html` (PR #52, commit `8bc4ab0`, chạy trên `1cb531b54`, wall time `05:20` lần 1 và `01:51 – 02:01` các lần sau). **Lưu ý thiếu sót:** báo cáo HTML ghi rõ *"global Yarn cache and Docker images were warm (not a fresh OS install)"*, tức chưa phải máy chưa từng tải image Docker. | **Khớp số liệu**, cần làm rõ nghĩa "máy sạch" (chỉ sạch repo/env, Docker image đã warm nên lần 1 mất 5m20s thay vì ~6 phút như README). |
| CI (GitHub Actions) | `Ubuntu 26.04.1 LTS`, image `ubuntu-26.04` phiên bản `20261116.88.1`; job `test-integration`, `215/215` đạt 1 lần, `1 phút 1 giây` | Khớp API GitHub Actions run `45211903702` (PR #48, commit `586624f`): step `Run integration tests` chạy từ `16:03:00Z` đến `16:04:01Z` (`61s` = 1 phút 1 giây). Tuy nhiên `.github/workflows/ci.yml` khai báo `ubuntu-latest` (tự map sang `ubuntu-26.04` tại thời điểm chạy), và từ PR #48 đã thêm `dorny/paths-filter` nên `test-integration` **bị skip** khi PR không sửa code server/test (như PR #52 run `45745530646` đã `skipped`). | **Khớp thời gian**, cần chú thích `ubuntu-latest` và điều kiện skip của job. |

### 1.2. Bảng 6.2 – Coverage dòng theo chức năng (Mục 6.3)

Đối chiếu với `vitest.integration.config.ts` và `docs/ISSUE26_TEST_VALIDITY_REPORT.html` (Mục 1):

1. **Độ lệch cộng dồn (`832/1309` vs `845/1327`):**
   - Đoạn văn trên Bảng 6.2 ghi: `Toàn bộ phạm vi đạt 63,67% số dòng (845/1327) và 63,21% số nhánh (500/791)` — con số này khớp `ISSUE26_TEST_VALIDITY_REPORT.html:269-271` (`63.67%`, `63.21%`) và tổng dòng `1327` ở commit `3921004` (`616/1327`).
   - Cộng trực tiếp 7 hàng trong Bảng 6.2:
     - Dòng đã chạy: `196 + 144 + 186 + 145 + 36 + 98 + 27 = 832` (thiếu `13` dòng so với `845`).
     - Tổng dòng: `211 + 146 + 253 + 174 + 55 + 100 + 370 = 1309` (thiếu `18` dòng so với `1327`).
   - Nguyên nhân: `13/18` dòng còn lại là mã khai báo module/router ở top-level ngoài các route handler trong `collections.ts`, `documents.ts`, `shares.ts`, nhưng Bảng 6.2 **không có dòng "Khác / Khởi tạo router"** và **không có dòng "Tổng"**, dễ gây thắc mắc khi cộng kiểm tra.
2. **Số lượng route handler:** Bảng 6.2 liệt kê `13 + 11 + 2 + 4 + 24 = 54` route handler, trong khi 3 file `collections.ts` (19 `router.post`), `documents.ts` (29 `router.post`), `shares.ts` (6 `router.post` + 3 `router.get`) có tổng cộng **57 endpoint**. Có 3 endpoint (ví dụ nhóm `collections.create/delete/archive/restore/move` hoặc `shares.subscribe/confirmSubscription/unsubscribe` — cần xác nhận lại script tách coverage đã gộp hay loại endpoint nào).
3. **Số liệu `ISSUE26_TEST_VALIDITY_REPORT.html` bị stale ở văn bản nền:** Dòng 628 của file HTML repo vẫn ghi `shares 33, collections 49 and documents 69 tests` (cũ từ trước khi thêm test policy/collection/share lên `39 / 50 / 69`), nên không đồng bộ hoàn toàn với 215 test dù bảng coverage trong đó đã là bản cuối.

### 1.3. Bảng 6.3, 6.4, 6.5 – Mutation testing (Mục 6.4)

1. **Bảng 6.3 (So sánh mốc `45 test` và `215 test`):**
   - **Cột `45 test` bị trộn số liệu giữa các mốc:**
     - `Coverage dòng (46,42%)` và `Coverage nhánh (43,86%)`: theo lịch sử git của `ISSUE26_TEST_VALIDITY_REPORT.html` ở commit `3921004` (PR #43, ngày 18/11/2026), hai con số `46.42% (616/1327)` và `43.86% (347/791)` được đo trên bộ **49 test** (sau khi đã thêm 4 test phủ định), **không phải 45 test**.
     - `Mutation score, route handler (30,42%)` (và chi tiết `160 killed`, `216` uncovered = `41%` ở đoạn văn trang 32 vật lý): con số này **không xuất hiện** trong `ISSUE26_TEST_VALIDITY_REPORT.html` hay bất kỳ commit/PR nào trong repo. Mốc route-handler "Before" được lưu trong repo (`03f4337`, PR #44) là **`36,12%`** (`190 killed, 159 survived, 177 no coverage` trên bộ **53 test**). Cần bổ sung bằng chứng/chú thích rõ nếu `30,42%` được chạy riêng trên commit `b5aa4db` (45 test), hoặc đổi sang mốc 53 test đã lưu chứng cứ trong repo.
     - `Mutation score, policy và command (31,65%)` và `Safeguard gỡ thủ công (2 / 6)`: **Khớp** với `ISSUE26_TEST_VALIDITY_REPORT.html` (commit `3921004` & `03f4337`).
   - **Cột `215 test` thiếu đồng bộ số lẻ thập phân:** ghi `93,7%` và `79,4%` (1 số lẻ) ngay trên `63,67%` và `63,21%` (2 số lẻ), trong khi Bảng 6.4 và 6.5 ghi `93,73%` và `79,42%`.
2. **Bảng 6.4 (Mutation score trên route handler):**
   - Collection: `200` mutant, `192` killed, `8` survived, `96,00%` -> **Khớp 100%** với `ISSUE26_TEST_VALIDITY_REPORT.html:640-645`.
   - Document: `164` mutant, `151` killed, `13` survived, `92,07%` -> **Khớp 100%** (`648-653`).
   - Share: `162` mutant, `150` killed, `12` survived, `92,59%` -> **Khớp 100%** (`656-661`).
   - Tổng: `526` mutant, `493` killed, `33` survived, `93,73%` -> **Khớp 100%** (`664-669`).
3. **Bảng 6.5 (Mutation score trên policy và command):**
   - `policies/document.ts`: `294` | `221` | `71` | `2` | `75,17%` -> **Khớp 100%** (`299-307`).
   - `policies/collection.ts`: `236` | `219` | `15` | `2` | `92,80%` -> **Khớp 100%** (`309-317`).
   - `policies/share.ts`: `21` | `19` | `2` | `0` | `90,48%` -> **Khớp 100%** (`319-327`).
   - `commands/documentMover.ts`: `96` | `60` | `29` | `7` | `62,50%` -> **Khớp 100%** (`329-337`).
   - `commands/documentRestorer.ts`: `48` | `33` | `15` | `0` | `68,75%` -> **Khớp 100%** (`339-347`).
   - Tổng: `695` | `552` | `132` | `11` | `79,42%` -> **Khớp 100%** (`349-357`).
   - **Lưu ý hiển thị:** Cột `Không có test` dễ bị giảng viên hiểu nhầm là "không có file test", nên đổi thành `Không có test phủ (No coverage)`.
4. **Mục 6.4.4 (Mutant survived và phần chưa đo):**
   - Chi tiết `46/71` mutant `document?.x -> document.x` và nhóm chưa đo (`898` mutant, `182` no coverage, `59` survived thêm) **khớp** với `ISSUE26_TEST_VALIDITY_REPORT.html:396-398, 1062-1067`, nhưng Word sót `collections.export_all` khi liệt kê (`ISSUE26_TEST_VALIDITY_REPORT.html:1063` có cả `collections.export` và `export_all`).

### 1.4. Bảng 6.6 – Manual breakage (Mục 6.5)

- **Số lượng & kết quả:** `5/6` bắt được, `1/6` dư thừa (`authorize(createShare)` ở `shares.create`) -> **Khớp** với `ISSUE26_TEST_VALIDITY_REPORT.html:534-583`.
- **Sai thuật ngữ trong Bảng 6.6:** Bảng dùng nhãn `Killed` / `Survived`, trong khi `DANH MỤC TỪ VIẾT TẮT VÀ THUẬT NGỮ` định nghĩa `Killed / Survived` là dành cho **Mutant do Stryker tạo ra**. Trong `ISSUE26_TEST_VALIDITY_REPORT.html`, bảng manual breakage dùng `Caught / Not caught` (và Slide 9 dùng `Bắt được / Không bắt: dư thừa`). Nên đổi `Killed / Survived` ở Bảng 6.6 sang `Bắt được / Không bắt được (dư thừa)` để tránh lẫn khái niệm.

### 1.5. Mục 6.6 & Bảng 6.7 – Lỗi, bất thường đối chiếu với PR và Commit

1. **Mục 6.6.1 – Lỗi tạo trùng revision (`BUG-1`):**
   - Đối chiếu `PR #42` (commit `724115e`) và `server/queues/processors/RevisionsProcessor.ts:35-58`:
     - Nguyên nhân check-then-insert (`Revision.findLatest()` rồi `Revision.createFromDocument()` không lock), tái hiện `8/8` lần, xuất hiện `1/5` lần chạy đầy đủ -> **Khớp** `ISSUE26_ANOMALY_REPORT.html:179-206`.
     - Giải pháp: bọc transaction + `lock: { level: transaction.LOCK.UPDATE, of: Document }` (`SELECT ... FOR UPDATE OF "document"`), bổ sung tham số `transaction` cho `Revision.findLatest()` -> **Khớp 100%** với code `RevisionsProcessor.ts:39-48`.
     - **Điểm thiếu trong Word (nên bổ sung nhẹ):** Word ghi chung `SELECT … FOR UPDATE` (chưa nêu rõ chi tiết kỹ thuật `OF "document"` / `of: Document` — pitfall do default scope của `Document` left-join bảng `users` nên Postgres từ chối `FOR UPDATE` thông thường trên outer join, đã ghi rất hay trong `724115e` và `ISSUE26_ANOMALY_REPORT.html:257-264`).
2. **Mục 6.6.2 – Flaky test (`FLAKE-2`):**
   - Đối chiếu `PR #42` (commit `3a3be05`) và `revisions.integration.test.ts:75-78`:
     - Bỏ `expect(await Revision.count()).toEqual(0);` ngay sau `documents.update` vì race với worker nhanh trên CI (local ~15 lần chưa từng fail, CI fail `expected 1 to deeply equal +0`). -> **Khớp 100%** với `3a3be05` và `ISSUE26_ANOMALY_REPORT.html:329-382`.
3. **Mục 6.6.3 & Bảng 6.7 – Phân loại Severity / Priority:**
   - `BUG-1`: Severity `Thấp`, Priority `Thấp` (theo ma trận chỉ ghi nhận, nhưng vì bản sửa nhỏ nên sửa luôn kèm regression test).
   - `FLAKE-2`: Severity `Thấp`, Priority `Cao` (chặn CI mọi PR chạm mã server -> sửa nhanh).
   - **Khớp** hoàn toàn với `ISSUE26_ANOMALY_REPORT.html:208-232, 363-368` và Bảng 3.6.
4. **Mục 6.6.4 – Hành vi cần xác nhận (đối chiếu trực tiếp `server/policies/`):**
   - **Hành vi 1 (`pinToHome`):** Word ghi *"Team admin có thể pin một tài liệu nằm trong collection riêng tư mà chính họ không đọc được."*
     - **Thiếu chính xác tên ability trong code:** Trong `server/policies/document.ts`:
       - `pin` / `unpin` (dòng 165–172) **CÓ** kiểm tra `can(actor, "update", document)` và `can(actor, "update", document?.collection)` nên team admin không pin vào collection được nếu không đọc/sửa được.
       - Chỉ có **`pinToHome`** (dòng 174–182) kiểm tra `!document?.isDraft && !!document?.isActive && isTeamAdmin && isTeamMutable` mà **không** kiểm tra `can(actor, "read", document)`. Cần viết rõ là **`pinToHome` (ghim tài liệu ra trang chủ)** chứ không phải `pin` nói chung.
   - **Hành vi 2 (`Guest` có membership `Admin` trên collection):** Word ghi *"Guest có membership Admin trên một collection có thể update, archive, delete và export collection đó."*
     - **Thiếu điều kiện trong code:** Theo `server/policies/collection.ts:195-238`, `update`, `archive`, `delete` đúng là không chặn `user.isGuest`. Riêng **`export`** (dòng 206–216) yêu cầu thêm `can(user, "download", collection)`, mà `download` (dòng 57–65) từ chối `guest` **trừ khi** team bật `TeamPreference.ViewersCanExport` (trong `collection.integration.test.ts:595` guest có `export` vì `buildTeam()` mặc định bật preference này, còn khi tắt thì bị từ chối như test ở dòng `1126`). Cần bổ sung điều kiện *(khi team cho phép viewer/guest export)*.
   - **Mã lỗi `403` vs `404`:** Khớp `collections.integration.test.ts:551` (`expect([403, 404]).toContain(status)`) và `shares.integration.test.ts:122, 225`.

---

## 2. Rà soát Phụ lục A (45 test chính: `10 / 6 / 11 / 4 / 4 / 8 / 2`) và Bảng chú thích ký hiệu

### 2.1. Kiểm tra cấu trúc số lượng `10 / 6 / 11 / 4 / 4 / 8 / 2`

- Tổng số trong Phụ lục A: `10 + 6 + 11 + 4 + 4 + 8 + 2 = 45` test (mốc ban đầu sau PR #42).
- Khi đối chiếu với 53 test trong `ISSUE26_INTEGRATION_TESTS.html`, 8 test không nằm trong Phụ lục A đúng là 4 test thêm ở PR #43 + 4 test thêm ở PR #44:
  - Thiếu 1 test ở `A.2` (`should not let another team read a collection, even an open one` — `collections.integration.test.ts:579`, được xếp vào cột "+1 Bổ sung" ở Bảng 3.4).
  - Thiếu 6 test ở `A.3` (`documents.integration.test.ts:643, 675` từ PR #43 và `L707, 740, 794, 823` từ PR #44 — xếp vào "+50 Bổ sung" ở Bảng 3.4).
  - Thiếu 1 test ở `A.6` (`shares.integration.test.ts:103` từ PR #43 — xếp vào "+31 Bổ sung" ở Bảng 3.4).
- **Tổng khớp với Bảng 3.4 và tổng hiện tại `215` test trên 7 file:** `collections (50) + documents (69) + shares (39) + policy/document (28) + policy/collection (23) + revisions (4) + users (2) = 215`.

### 2.2. Sai lệch chi tiết từng test case trong Phụ lục A so với mã nguồn

| Mã | Tên test case trong code | Sai sót / khác biệt giữa Phụ lục A và file test thực tế |
| --- | --- | --- |
| **A.1.3** | `should default user permission to defaultCollectionPermission when adding user` (`collections.integration.test.ts:161-189`) | Word bước 2 ghi: *"Đọc membership vừa tạo trong database"*. **Thực tế code** kiểm tra `addBody.data.memberships` từ **HTTP response**, không query bảng `UserMembership` trong database; và `user` dùng giá trị `defaultCollectionPermission` mặc định của factory chứ không gán tường minh. |
| **A.1.5** | `should update collection privacy and affect access` (`collections.integration.test.ts:242-287`) | Word chuẩn bị ghi: *"U1 có quyền Read trong collection đang mở"*. **Thực tế code** (dòng 249): collection khởi tạo đã là **`permission: null` (riêng tư sẵn)**, không phải collection đang mở; bước 2 cũng không assert `status === 200` cho `collections.update`. |
| **A.1.6** | `should revoke user access after double remove_user call` (`collections.integration.test.ts:289-339`) | Code không assert `200` ở lần `remove_user` thứ nhất (Word ghi `→ 200`). |
| **A.1.10** | `should keep group access after direct membership is removed` (`collections.integration.test.ts:497-528`) | Word chưa nêu rõ mức quyền cụ thể: trong code, quyền trực tiếp là `ReadWrite` còn quyền qua group là `Read`. |
| **A.2.6** | `should not add a user from another team to a collection` (`collections.integration.test.ts:659-674`) | Word ghi *"Admin team A gọi collections.add_user"*. Trong code `setup()` (dòng 535), `userA` được tạo bằng `buildUser` (role **member**, là người tạo/Admin của collection), không phải team `Admin` theo định nghĩa bảng ký hiệu. |
| **A.3.5** | `should reorder siblings to the requested index` (`documents.integration.test.ts:434-455`) | **SAI KẾT QUẢ:** Word ghi *"thứ tự trong cấu trúc là **B, C, A**"*. Code thực tế (dòng 446 & 453) ghi rõ: `index: 2` chèn trước phần tử thứ 3 (`z`), nên kết quả assert là `[y, x, z]` tức **`B, A, C`**. |
| **A.4.3** | `should not create duplicate revisions for concurrent identical updates` (`revisions.integration.test.ts:128-158`) | Word bước 1 ghi `→ Cả hai 200`. Code dùng `Promise.all` nhưng không kiểm tra `res.status === 200`, chỉ kiểm tra `Revision.count === 1`. |
| **A.4.4** | `should restore a document to a specific revision` (`revisions.integration.test.ts:160-212`) | Word chuẩn bị ghi *"Document title 'Original'; cập nhật hai lần để có revision 1 và 2"*. Chính xác trong code: lần cập nhật 1 gửi lại `"Original"` để tạo revision 1, lần 2 gửi `"Modified"` tạo revision 2. |
| **A.5.1** | `should rank full-text search results via real Postgres trigger` (`documents.integration.test.ts:35-86`) | Word ghi *"chỉ trả về document chứa 'zebra'"*; thực tế code tạo 3 doc (`Alpha`, `Beta`, `Gamma`) và chỉ assert `contain("Beta")` và `not.toContain("Gamma")` (không assert độ dài mảng hay loại trừ `Alpha`, dù `Alpha` không chứa `zebra`). |
| **A.5.2** | `should scope search results by shareId` (`documents.integration.test.ts:88-145`) | **SAI NGHIÊM TRỌNG NHẤT PHỤ LỤC A:** Word ghi *"documents.search kèm shareId → 200; chỉ trả về document nằm trong X"*. Trong code thực tế: `buildShare(...)` không gán biến lấy `id`, request gọi `server.post("/api/documents.search", user, { body: { query: "Share scoped" } })` **không có `shareId`**, và chỉ `expect(ids).toContain(sharedDoc.id)` mà **không kiểm tra `Outside document` bị loại**. |
| **A.5.4** | `should remove permanently deleted documents from search and the database` (`documents.integration.test.ts:340-365`) | Word chưa nêu rõ: user là `Admin` và lần gọi `documents.delete` thứ hai phải truyền `permanent: true`. |
| **A.6.7** | `should not expose a document outside the shared subtree` (`shares.integration.test.ts:209-227`) | Word ghi *"Share trên document D (kèm các con)"*; thực tế code bật `includeChildDocuments: true` trên `D` nhưng không tạo document con nào dưới `D` (chỉ có doc `outside` cùng collection để kiểm tra). |
| **A.7.2** | `should start each test with an empty database` (`users.integration.test.ts:26-34`) | Word ghi *"Đếm các bảng dữ liệu khi bắt đầu test"*; thực tế code chỉ đếm `User.count()` và `Team.count()`, chưa đếm các bảng khác. |

*(Các test còn lại trong 45 test — A.1.1, A.1.2, A.1.4, A.1.7, A.1.8, A.1.9, A.2.1–A.2.5, A.3.1–A.3.4, A.3.6–A.3.11, A.4.1, A.4.2, A.6.1–A.6.6, A.6.8, A.7.1 — khớp với mã nguồn.)*

### 2.3. Rà soát Bảng chú thích ký hiệu (đầu Phụ lục A)

| Vấn đề | Chi tiết |
| --- | --- |
| **Thiếu mã HTTP `400` và `5xx`** | Bảng chú thích chỉ liệt kê `200, 403, 404`, nhưng **A.1.6** dùng `400`, **A.3.7** dùng `400`, và **A.3.8** dùng `5xx`. |
| **Ký hiệu user/team không khớp giữa bảng và nội dung** | Bảng định nghĩa `U1, U2, U3` và `Team khác`, nhưng các bảng test lại dùng **`Team A`**, **`Team B`**, **`UB`** (A.2.1–A.2.6), **`U`** (A.3.3, A.3.11), **`Owner`** (A.3.3), **`Guest`** (A.6.2), **`D`, `E`** (A.6.7). Ngược lại, cụm `Team khác` không được dùng làm tên thực thể trong test nào. |
| **Vai trò `Admin` chưa phân biệt Team Admin vs Collection Admin** | Trong A.2.6, người gọi `collections.add_user` là `userA` (role member, chủ collection), nhưng bảng chú thích định nghĩa `Admin` là *"User có role admin của team"*. |

---

## 3. Đối chiếu toàn bộ Slide (`claude.ai/artifact/...`) với Code & File Word

| Slide | Nội dung trên Slide | Sai sót / thiếu sót khi đối chiếu với Code & Word |
| --- | --- | --- |
| **Slide 1** | Ngày `1/12/2026`, nhóm, GVHD | Trang bìa Word không ghi ngày `1/12/2026` (chỉ có ở mục 3.2.5 và Bảng 4.1). |
| **Slide 2** | Nêu 4 luồng, "một phiên bản mã nguồn cố định" | Thiếu link repo fork `alphatrann/outline` và mã commit cố định `05ef55e` (nên có ở footer hoặc slide này để tiện kiểm chứng). |
| **Slide 3** | `215/215`, `93,7%`, `63,7%` (`63,2%`), `1 + 1` | Làm tròn 1 chữ số thập phân (`93,7%`, `63,7%`, `63,2%`); chưa nhắc con số `79,4%` (policy/command) và `2` hành vi permission cần xác nhận (đến Slide 8 và Slide 11 mới có). |
| **Slide 4** | *"Mỗi test dựng dữ liệu, gọi qua API thật, rồi đọc lại database để kiểm tra."* | **Không đúng hoàn toàn với code:** (1) `51` test Policy gọi trực tiếp policy, không qua HTTP API (speaker notes có giải thích, nhưng chữ trên slide gây hiểu nhầm). (2) Nhiều test trong `collections.integration.test.ts` (như A.1.1, A.1.2, A.1.3, A.1.4, A.1.5, A.1.6, A.1.8, A.1.9, A.1.10) chỉ assert HTTP response, **không đọc lại DB**. |
| **Slide 5** | *"Chỉ cần Node, Yarn và Docker đang chạy"* và bảng *"CI trên mỗi pull request: 215/215"* | **2 thiếu sót so với repo:** (1) Với Node 26 (`.nvmrc` và `README.md:97`), Node 26 không kèm sẵn Corepack nên máy sạch phải chạy thêm `npm install -g corepack && corepack enable` (được `ISSUE24_CLEAN_MACHINE_REPORT_DinhHieu.html:140` xác nhận). (2) Trong `.github/workflows/ci.yml` (từ PR #48), `test-integration` **không** chạy trên *mọi* pull request mà dùng `dorny/paths-filter` để bỏ qua PR chỉ sửa docs/unit test. Ngoài ra, đơn vị thời gian Windows bị cụt (`1 phút 23 – 1 phút 31` thiếu chữ `giây`). |
| **Slide 6** | 6 thanh coverage (`92,9%`, `98,6%`, `73,5%`, `83,3%`, `65,5%`, `98,0%`) và tổng `63,7%` dòng | **Thiếu sót gây hiểu nhầm nghiêm trọng:** Slide bỏ mất nhóm thứ 7 trong Bảng 6.2 (`Chưa nhắm tới: 24 route handler = 7,3%`). Giảng viên nhìn 6 thanh đều `>= 65,5%` mà tổng chỉ `63,7%` sẽ lập tức hỏi vì sao vô lý. Đồng thời speaker notes nói nhánh public của search chưa kiểm thử — mâu thuẫn với Phụ lục A.5.2. |
| **Slide 7** | *"Bộ 45 test ban đầu: 30,4% — route handler... 41% mutant nằm ở mã mà không test nào chạy tới"* | **Giống Bảng 6.3:** Số `30,4%` (`160/526`, `216` uncovered) không có trong `ISSUE26_TEST_VALIDITY_REPORT.html` hay commit/PR nào của repo (repo chỉ lưu mốc `36,12%` ở bộ 53 test). |
| **Slide 8** | Điểm mutation theo từng phần (`96,0%` ... `62,5%`) | Làm tròn 1 chữ số thập phân (`68,75%` -> `68,8%`, `92,59%` -> `92,6%`, `92,07%` -> `92,1%`, `75,17%` -> `75,2%`), khớp Bảng 6.4 & 6.5 (chỉ lưu ý đồng bộ số lẻ với Word). Không hiển thị `11` mutant `No coverage` ở policy/command. |
| **Slide 9** | Gỡ 6 safeguard thủ công (`5/6` bắt được, `2/6` ở bộ 45 test) | Khớp `ISSUE26_TEST_VALIDITY_REPORT.html` và tốt hơn Bảng 6.6 ở chỗ dùng chữ *"Bắt được / Không bắt: dư thừa"* thay vì `Killed / Survived`. |
| **Slide 10** | *"Tạo trùng bản lưu: hai tiến trình nền cùng thấy chưa có bản lưu rồi cùng thêm vào"* và *"Flaky test... chặn CI"* | (1) Về kỹ thuật: không chỉ trường hợp *"chưa có bản lưu"*, mà là cả hai cùng đọc cùng trạng thái `previous` trước khi transaction kia commit (`RevisionsProcessor.ts:46-58`). (2) Trên slide ghi `chặn CI` (speaker notes ghi `trên mỗi pull request`), thiếu ý *"chạm vào mã server"* như Word 6.6.3 (do có path filter ở `ci.yml`). |
| **Slide 11** | *"Quản trị viên team ghim tài liệu trong collection riêng tư: Làm được dù chính họ không đọc được collection đó"* và *"Khách có quyền Admin trên một collection: Có thể cập nhật, lưu trữ, xóa và xuất collection đó."* | **2 sai sót đối chiếu với code:** (1) Sai chi tiết: Team admin **đọc được** collection riêng tư (`policies/collection.ts:38-40`), cái họ không đọc được là **tài liệu** trong collection đó (`readDocument`), và quyền bị thiếu check là **`pinToHome`** (ghim ra trang chủ), không phải `pin` trong collection (`policies/document.ts:165-182`). (2) Thiếu điều kiện: Guest có Admin membership chỉ **`export`** được khi team bật `ViewersCanExport` (`policies/collection.ts:57-65, 206-216`). |
| **Slide 12** | Đánh giá tổng thể (`215/215`, `65,5% – 98,0%`, `98,6%`, `93,7%`, `79,4%`, `5/6`) | Khớp Word 6.7. |
| **Slide 13** | Hạn chế: liệt kê chức năng chưa đo (*Export collection, nhân bản tài liệu, nhánh public của tìm kiếm, import file và danh sách share*); *"Chờ việc nền bằng cách thăm dò"* | **Thiếu** `templatize` (`documents.templatize`) và `collections.export_all` so với `ISSUE26_TEST_VALIDITY_REPORT.html:1063-1064` (Word 6.8 có `templatize`). Ngoài ra, mục "Chờ việc nền bằng cách thăm dò" mâu thuẫn với Slide 15 ("Thay việc chờ cố định"). |
| **Slide 14** | 5 sprint & phân công thành viên | Khớp Bảng 4.1 (Slide bỏ ngày tháng Sprint) và phân công thực tế theo issue/PR trên GitHub (`alphatrann`, `gsb-b60`, `NHNam1209`). Lưu ý Word không có mục bảng phân công 3 người chi tiết như Slide 14. |
| **Slide 15** | Hướng phát triển (5 mục) | Mục 3 **thiếu** `templatize` và `danh sách share` (`shares.list`) so với Slide 13 và Word 7.2. Mục 4 nói *"Thay việc chờ cố định"* nhưng Slide 13 vừa nói *"thăm dò"* (không giải thích là `A.4.2`/`A.4.3` có `setTimeout` cố định). |
| **Slide 16** | Cảm ơn | Không có sai sót kỹ thuật. |

---

## 4. Rà soát chính tả, văn phong (Trang chẵn & Chương 6–7, Phụ lục) và Góc nhìn giảng viên

> **Lưu ý về đánh số trang:** Trong file Word trên Windows, phần đầu gồm Bìa (trang vật lý 1) + Danh mục số La Mã `i–v` (trang vật lý 2–6), phần nội dung bắt đầu từ trang vật lý 7 (trang nội dung `1`). Do font trên Windows làm giãn dòng nhẹ, Mục lục trong Word đang bị lệch 1–2 trang so với trang thực tế (ví dụ Chương 6 ghi trang `22` nhưng thực tế hiển thị ở trang nội dung `23` / vật lý `29`; Phụ lục A ghi trang `32` nhưng hiển thị trang nội dung `34` / vật lý `40`). **Cần cập nhật lại Mục lục, Danh mục hình ảnh và Danh mục bảng biểu trước khi xuất PDF nộp.**

### 4.1. Lỗi chính tả, định dạng và văn phong trên các trang chẵn & phần phụ trách

1. **Trang chẵn phần đầu & Chương 1–5 (trang nội dung chẵn `2, 4, 6, 8, 10, 12, 14, 16, 18, 20` + trang vật lý `2, 4, 6`):**
   - **Khoảng trắng kép ở tiêu đề & tài liệu tham khảo:** Toàn bộ tiêu đề (`CHƯƠNG 1.  ...`, `1.1.  ...`, `PHỤ LỤC A.  ...`) và mục `[1]  ...` có **2 dấu cách** liên tiếp sau dấu chấm hoặc dấu ngoặc.
   - **Trang `i` (Mục lục) & `iii` (Danh mục hình ảnh):** Số trang trong Mục lục chưa cập nhật theo bản dàn trang cuối (Chương 6 lệch 1 trang, Phụ lục A lệch 2 trang).
   - **Trang `v` (Danh mục từ viết tắt):** Giải thích `SHA` viết *"trong git"* (nên viết hoa `Git`).
   - **Trang 2 (Mục 1.4, Bảng 1.2):** Ghi `Policy: 98,5% – 100% dòng`, trong khi Bảng 6.2 gộp là `98,6%` — nên ghi rõ `98,5% – 100% (trung bình 98,6%)`.
   - **Trang 4 (Mục 2.1–2.3):** Dùng xen kẽ `tài liệu` / `document`, `cơ sở dữ liệu` / `database`, `hàng đợi` / `queue`, `bản giả` / `mock` — nên thống nhất quy ước ngay từ Chương 1 (giữ nguyên thuật ngữ tiếng Anh dạng từ chuyên ngành như `database`, `queue`, `mock` hoặc Việt hóa nhất quán).
   - **Trang 10 (Mục 3.2.2):** Cụm *"nhóm phải bù bằng việc dọn sạch dữ liệu"* — từ **"bù"** mang tính khẩu ngữ, nên sửa thành *"nhóm khắc phục/bù đắp bằng việc..."*.
   - **Trang 12 (Bảng 3.4):** Các gạch đầu dòng như *"Quyền theo membership; draft riêng tư; export; comment."*, *"Ngoài ra: import, membership."*, *"Ngoài ra: unpublish, template, pin."*, *"Ngoài ra: tìm theo title."*, *"Ngoài ra: sitemap, hiển thị công khai."* viết kiểu ghi chú rời rạc, thiếu vị ngữ; chưa giải thích ý nghĩa ký hiệu `–` ở hàng Policy.
   - **Trang 14 (Mục 3.2.5 / Bảng 3.6):** *"một lỗi có thể nặng nhưng chưa gấp, hoặc nhẹ nhưng chặn việc khác"* — từ **"nặng / gấp"** hơi văn nói, nên dùng *"nghiêm trọng / khẩn cấp"*.
   - **Trang 16 (Mục 4.1 & Bảng 4.1):**
     - Câu *"và ta chỉ biết hạ tầng có chạy ổn hay không sau khi thử"* — dùng đại từ **"ta"** lạc tông với ngôi **"nhóm"** xuyên suốt báo cáo.
     - Bảng 4.1 ghi Sprint 5 (`25/11 – 1/12`) là **"Hoàn thành"**, trong khi thực tế ngày rà soát (`27/11`) báo cáo/slide vẫn đang soát lỗi và Issue `#29` vẫn đang `open` (`In progress`).
   - **Trang 18 (Bảng 5.1):** Chỉ ghi `Node.js 24.21.0 (macOS); Yarn 4.18.1`, bỏ sót phiên bản Node.js đã chạy trên Windows (`24.18.0` và `26.13.1`) và phiên bản `.nvmrc` (`26`); `Testcontainers 12` nên ghi rõ `12.2.0`.
   - **Trang 20 (Bảng 5.3):** Dòng thứ 4 ghi chung chung `Hạ tầng test (thư mục server)` thay vì đường dẫn chuẩn `server/test/`, thiếu nhất quán với 3 dòng đầu ghi rõ tên file.

2. **Chương 6–7 & Phụ lục A (trang nội dung `22–38`, đặc biệt các trang chẵn `22, 24, 26, 28, 30, 32, 34, 36, 38`):**
   - **Thiếu nhất quán số thập phân (dấu phẩy & số chữ số sau dấu phẩy):**
     - Bảng 6.2 & Bảng 1.2 dùng 1 chữ số (`92,9%`, `93,7%`, `79,4%`).
     - Mục 6.3, 6.4.3 (Bảng 6.4, 6.5) dùng 2 chữ số (`63,67%`, `93,73%`, `79,42%`).
     - Bảng 6.3 trộn cả 2 chữ số (`30,42%`, `46,42%`) lẫn 1 chữ số (`93,7%`, `79,4%`) trong cùng một bảng!
     - Bảng 3.5 & Mục 7.1 làm tròn số nguyên (`94%`, `79%`).
   - **Lặp ý nguyên văn/gần nguyên văn:**
     - Cụm *"một bộ test đạt / toàn màu xanh chưa nói lên / chứng minh được điều gì"* lặp lại ở Bảng 3.3 (trang 11), dẫn nhập Chương 6 (trang 22), Mục 6.3 (trang 23), Mục 7.1 (trang 30).
     - Đoạn giải thích bảng 6.1 lặp ý giữa Mục 6.1 và 6.2 (trang 22).
   - **Dịch sát từ tiếng Anh (chưa tự nhiên trong tiếng Việt):**
     - Mục 6.4.4: *"không thể đến được qua API"* -> nên sửa thành *"không thể kích hoạt / đi tới được qua API"*.
     - Mục 6.6.4: *"đường xử lý này trả về 403 còn đường khác trả về 404"* (dịch từ *path*) -> nên sửa thành *"endpoint hoặc nhánh xử lý này trả về 403 còn nhánh khác trả về 404"*.
     - Mục 6.5: *"Đây là defense in depth"* -> nên viết *"Đây là cơ chế phòng thủ nhiều lớp (defense in depth)"*.
   - **Tên cột dễ gây hiểu nhầm:** Bảng 6.5 dùng cột `Không có test` (nên đổi thành `Chưa phủ (No coverage)`). Bảng 6.6 dùng `Killed / Survived` (nên đổi thành `Bắt được / Không bắt được`).

### 4.2. Các câu/đoạn nghe khó hiểu hoặc dễ bị giảng viên hỏi vặn

1. **Mục 6.3 (Bảng 6.2) & Slide 6:** *"Vì sao tất cả các dòng/cột chức năng đều từ 65,5% đến 98,6% mà tổng phạm vi chỉ có 63,67% (63,7%)?"*
   - Trong Word có dòng `Chưa nhắm tới (7,3%)` nhưng tổng các dòng vẫn thiếu `13/18` dòng ngoài handler (`832/1309` vs `845/1327`). Trên Slide 6 lại bỏ mất dòng `Chưa nhắm tới`, rất dễ bị thầy hỏi ngay lúc thuyết trình.
2. **Mục 6.4.2 (Bảng 6.3) & Slide 7:** *"Tại sao bảng so sánh ghi 45 test có 30,42% route mutation và 46,42% coverage, trong khi báo cáo HTML trong repo ghi 36,12% và 46,42% là của 49 test?"*
   - Cần tách rõ mốc `45 test` (PR #42), `49 test` (PR #43), `53 test` (PR #44) hoặc bổ sung ghi chú/log cho số `30,42%`.
3. **Mục 6.3 / 6.4.4 vs Phụ lục A.5.2:** *"Nhóm nói nhánh `shareId` (public) của search chưa được kiểm thử, vậy test A.5.2 `should scope search results by shareId` trong Phụ lục A đang test cái gì?"*
   - Cần sửa lại code test `A.5.2` trong `documents.integration.test.ts` (truyền thật `shareId` và assert loại trừ doc ngoài share) **hoặc** cập nhật lại Phụ lục A / Bảng 3.4 theo đúng code hiện tại.
4. **Mục 3.2.2 vs Mục 7.2 (và Slide 13 vs Slide 15):** *"Ở Chương 3 nhóm khẳng định không chờ cố định mà dùng polling, tại sao ở Hướng phát triển (7.2 và Slide 15) lại đề xuất thay việc chờ cố định?"*
   - Cần giải thích rõ: `A.4.1` và `A.4.4` dùng polling (`waitForLatestRevision`), còn hai test chống trùng lặp `A.4.2` và `A.4.3` trong `revisions.integration.test.ts` vẫn phải chờ cố định `2–3 giây` (`setTimeout`) để chắc chắn worker không tạo thêm revision thứ hai.
5. **Mục 6.6.4 & Slide 11:** *"Team admin không đọc được collection riêng tư thì sao họ vào để pin được?"* và *"Guest có quyền Admin trên collection luôn export được kể cả khi team tắt export cho viewer/guest à?"*
   - Cần sửa chính xác theo code: Team admin **đọc được** collection riêng tư, chỉ không đọc được *document* bên trong, và hành vi thiếu check là `pinToHome`; còn Guest Admin chỉ `export` được khi team bật `ViewersCanExport`.
6. **Mục 6.2 & Slide 5:** *"Thế nào là 'máy sạch'? Lần đầu tải image Docker và cài thư viện mà Windows 11 Pro chạy ngay 1 phút 31 giây, Windows 11 Home mất 5 phút 20 giây là đã bao gồm tải image Docker chưa?"*
   - Cần nói rõ theo `ISSUE24_CLEAN_MACHINE_REPORT_DinhHieu.html`: máy sạch nghĩa là clone mới, chưa có `.env`, chưa build và chưa có `node_modules`, nhưng Docker image (`postgres:17`, `redis:8`) đã có sẵn trong cache máy.

---

## 5. Danh sách việc cần sửa trước khi đóng Issue #29

1. **[Code / Báo cáo] Sửa hoặc cập nhật lại test `A.5.2` (`should scope search results by shareId`)** để test và Phụ lục A khớp nhau (và đồng bộ lại nhận định về nhánh public của `documents.search` ở Mục 6.3, 6.4.4, 6.8, Slide 6, 13, 15).
2. **[Word] Sửa các sai lệch số liệu & mô tả:**
   - Sửa thứ tự kỳ vọng ở **A.3.5** từ `B, C, A` thành `B, A, C`.
   - Cập nhật **A.1.3** (kiểm tra response chứ không đọc DB), **A.1.5** (collection khởi tạo đã private sẵn), **A.2.6** (`userA` là member tạo collection, không phải team Admin), **A.4.3** (không assert 200), **A.7.2** (chỉ đếm bảng `User` và `Team`).
   - Bổ sung đầy đủ ký hiệu (`400`, `5xx`, `Guest`, `Owner`, `U`, `UB`, `Team A/B`) vào **Bảng chú thích ký hiệu Phụ lục A**.
   - Sửa **Bảng 6.2** (thêm dòng `13/18` dòng ngoài handler và dòng `Tổng: 845/1327`), **Bảng 6.3** (làm rõ mốc `45` vs `49` vs `53` test và đồng nhất số thập phân), **Bảng 6.5** (đổi tên cột `Không có test` -> `Chưa phủ`), **Bảng 6.6** (đổi `Killed / Survived` -> `Bắt được / Không bắt được`).
   - Sửa **Mục 6.6.4** (nêu rõ `pinToHome` và điều kiện `ViewersCanExport` khi Guest export) và **Mục 7.2** (nêu rõ chờ cố định nằm ở hai test dedup `A.4.2`, `A.4.3`).
   - Cập nhật **Mục lục, Danh mục hình ảnh, Danh mục bảng biểu** trên Word trước khi xuất PDF.
3. **[Slide] Cập nhật lại Slide 4, 5, 6, 7, 10, 11, 13, 15:**
   - Thêm nhóm `Chưa nhắm tới (7,3%)` vào **Slide 6** để khớp tổng `63,7%`.
   - Sửa **Slide 11** đúng theo `pinToHome` / không đọc được *tài liệu* trong collection riêng tư, và điều kiện `ViewersCanExport`.
   - Chỉnh **Slide 4** (nói rõ 51 test Policy gọi trực tiếp và không phải mọi test đều đọc lại DB), **Slide 5** (thêm lưu ý Corepack trên Node 26 và `paths-filter` trên CI, thêm chữ `giây`), **Slide 7** (đồng bộ mốc so sánh với repo), **Slide 13 & 15** (đồng nhất danh sách chức năng chưa test và giải thích polling vs chờ cố định).
