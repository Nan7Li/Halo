# Halo 1.2.0 正式版

Halo 的第一個正式版。它把家裡的 NAS 變成一支電話：SIM 卡留在家，通話和簡訊透過網頁、iPhone 或 SIP 軟電話帶到你身邊。核心使用 VoCat v0.3.42。

## 重點

- **全新介面**：仿 iOS 27 / macOS 的 Liquid Glass 設計，手機底部分頁、電腦懸浮側欄；可以調透明度、強調色、動畫和大頭照。新的 Halo 圖示，支援 iPhone「加入主畫面」。
- **電話**：iOS 風格的撥號鍵盤、最近通話、全螢幕通話畫面、任何頁面都會跳的來電橫幅、通話錄音。
- **更好的通話音質**：瀏覽器通話改用 AudioWorklet、抖動緩衝和帶限重取樣，NAS 端的 ALSA 上行改為定速送出，減少雜音和斷續。
- **iPhone 聽筒**：Halo 可以扮演 AirSIM 的安卓端，iPhone 上的 AirSIM App 直接用 Halo 的線路打電話、收簡訊；支援本地、Tailscale、公網網域和 AirSIM 雲端模式。
- **VPS 中繼**：家裡沒有公網 IP 也能從外面連回來。Halo 自動產生 WireGuard 金鑰和 VPS 一鍵安裝腳本；iPhone 可以直接走你 VPS 上已有的代理節點。
- **安卓手機線路**：裝了 AirSIM 的安卓手機可以成為 Halo 的一條線路。
- **CellBridge 整合**：SIP 閘道和大疆 QDC507 蜂窩語音橋。
- **NAS 一鍵安裝與自動更新**：Debian 13 / amd64 一行指令安裝；安裝程式預設裝正式版，加 `--preview` 可裝預覽版。
- **修正**：AT 指令錯誤黏在資料行時不再卡住、ADB 本機 socket 能正確啟動伺服器、Vodafone UK 下行簡訊等。

## 安裝與更新

全新安裝（Debian 13 / amd64）：

```bash
sudo bash -o pipefail -c 'apt-get update && apt-get install -y curl ca-certificates && curl -fsSL https://raw.githubusercontent.com/Nan7Li/VoCat/halo/scripts/deploy-cellbridge-nas.sh | bash'
```

已經安裝的 NAS 會在「设置」→「系统与更新」收到這個版本，帳號、設定、錄音和大疆運行檔都會保留。

完整教程：[docs/GUIDE.zh-TW.md](https://github.com/Nan7Li/VoCat/blob/halo/docs/GUIDE.zh-TW.md)

## 尚未完成

以下功能已包含在這個版本，但還沒完成或沒有在真實硬體上驗證：

- **大疆 QDC507 蜂窩語音**、**SIP 閘道**：只用模擬裝置和單元測試驗證過。SIP 只支援 UDP。
- **iPhone 聽筒**：
  - 不支援 DTMF 和早期媒體。
  - 雲端模式一次只服務一台 iPhone，還沒在真實 Relay 上驗證。
  - 本地模式下 App 要在前景才收得到來電。
- **安卓手機線路**、**VPS 中繼**：還沒在真實手機和 VPS 上驗證。
- **瀏覽器通話**：只在 Chromium 自動化驗證過；麥克風需要 HTTPS。
- **其他平台**：Windows 原生 WWAN 和桌面用戶端仍是草稿；NAS 安裝包只有 Debian 13 / amd64。

## 致謝

謝謝 [VoCat](https://github.com/MengMengCode/VoCat)（MengMengCode 與 Vocat Project Authors）、[CellBridge](https://github.com/mccding/CellBridge)（mccding）、[AirSIM](https://github.com/kai-wu-cortex/AirSIM)（kai-wu-cortex）、[MaVo](https://github.com/moluncn/mavo)（moluncn）和 [quectel-qmi-go](https://github.com/iniwex5/quectel-qmi-go)（iniwex5）的作者與貢獻者。沒有他們公開的成果，就沒有 Halo。

## 授權

Halo 的核心建立在 VoCat 之上，整體適用 [Vocat Research & Evaluation License](https://github.com/Nan7Li/VoCat/blob/halo/LICENSE)：僅限非商業的研究、教育與個人硬體開發，並有地區、評估期與 SIM 卡使用上的限制。CellBridge 部分另依 MIT，AirSIM 協定部分另依 PolyForm Noncommercial 1.0.0。Halo 不是上述任何專案的官方產品。
