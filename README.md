# SillyTavern AI Lorebook Editor Tool

這是一個專為 SillyTavern 設計的 UI 擴充功能（Extension），旨在讓 AI 模型在聊天對話中能夠透過 **Function Calling (函數呼叫)**，直接動態編輯與維護世界書（Lorebook/World Info）條目。

## 功能特點

本擴充功能為 AI 註冊了以下三個工具：
1. `get_lorebook_entries`：讓 AI 讀取當前聊天綁定的世界書中所有已存在的條目（包括 UID、觸發關鍵字、描述與備註），以便讓 AI 掌握目前的狀態。
2. `create_lorebook_entry`：當玩家建造了新設施、探索到新地點、或遇到了新角色時，AI 可以主動呼叫此工具，為世界書動態新增設定。
3. `update_lorebook_entry`：讓 AI 能夠隨時更新現有條目的內容（例如：修改地點的毀損狀態、調整角色之間的長期好感度與關係、更新角色裝備）。

## 安裝與設定方式

1. **透過 URL 安裝**：
   在 SillyTavern 的擴充功能管理器中，使用本 GitHub 倉庫的 URL 進行安裝。
   
2. **啟用函數呼叫**：
   - 開啟 SillyTavern 的「**AI 回覆設定 (AI Response Configuration)**」面板。
   - 勾選啟用「**函數呼叫 (Enable function calling)**」。
   - 確保您使用的 LLM 模型支援 Tool Calling 功能（例如 Claude, GPT-4, Gemini 等）。

3. **角色卡提示詞整合**：
   建議在您的角色卡系統提示詞（System Prompt）中加入類似以下的指示，引導 AI 主動使用這些工具：
   > [!TIP]
   > 您已配備 `create_lorebook_entry` 與 `update_lorebook_entry` 工具。當世界環境發生動態改變、玩家建造新設施或與角色關係升級時，請務必主動調用這些工具來更新世界書設定，以保持長期的故事一致性。
