import * as vscode from 'vscode';
import axios from 'axios';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiPairProgrammer.chatView';

    private _view?: vscode.WebviewView;
    private _history: ChatMessage[] = [];
    private readonly _groqApiKey: string | undefined;
    private readonly _groqApiUrl: string;

    constructor(groqApiKey: string | undefined, groqApiUrl: string) {
        this._groqApiKey = groqApiKey;
        this._groqApiUrl = groqApiUrl;
    }

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true
        };

        webviewView.webview.html = this._getHtml();

        // Listen for messages sent from the webview (the chat UI)
        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'sendMessage') {
                await this._handleUserMessage(message.text);
            }
        });
    }

    private async _handleUserMessage(userText: string) {
        if (!this._view) {
            return;
        }

        // Add user's message to history and show it immediately
        this._history.push({ role: 'user', content: userText });
        this._view.webview.postMessage({ type: 'addMessage', role: 'user', text: userText });

        if (!this._groqApiKey) {
            this._view.webview.postMessage({
                type: 'addMessage',
                role: 'assistant',
                text: 'Error: Groq API key not found. Check your .env file.'
            });
            return;
        }

        // Show a "thinking..." placeholder
        this._view.webview.postMessage({ type: 'showThinking' });

        try {
            const response = await axios.post(
                this._groqApiUrl,
                {
                    model: 'llama-3.1-8b-instant',
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a helpful AI pair programmer assistant inside a VS Code extension. Answer coding questions clearly and concisely.'
                        },
                        ...this._history.map(m => ({ role: m.role, content: m.content }))
                    ],
                    temperature: 0.5
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this._groqApiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const reply = response.data.choices[0].message.content;
            this._history.push({ role: 'assistant', content: reply });

            this._view.webview.postMessage({ type: 'hideThinking' });
            this._view.webview.postMessage({ type: 'addMessage', role: 'assistant', text: reply });

        } catch (error: any) {
            console.error(error);
            this._view.webview.postMessage({ type: 'hideThinking' });
            this._view.webview.postMessage({
                type: 'addMessage',
                role: 'assistant',
                text: `Error calling Groq API: ${error.message || 'Unknown error'}`
            });
        }
    }

    private _getHtml(): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                        padding: 0;
                        margin: 0;
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                    }
                    #messages {
                        flex: 1;
                        overflow-y: auto;
                        padding: 10px;
                    }
                    .message {
                        margin-bottom: 12px;
                        padding: 8px 10px;
                        border-radius: 6px;
                        white-space: pre-wrap;
                        word-wrap: break-word;
                        font-size: 13px;
                        line-height: 1.5;
                    }
                    .user {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        margin-left: 20px;
                    }
                    .assistant {
                        background-color: var(--vscode-editorWidget-background);
                        margin-right: 20px;
                    }
                    .thinking {
                        font-style: italic;
                        opacity: 0.7;
                        margin-right: 20px;
                        padding: 8px 10px;
                        font-size: 13px;
                    }
                    #inputArea {
                        display: flex;
                        padding: 10px;
                        border-top: 1px solid var(--vscode-panel-border);
                    }
                    #messageInput {
                        flex: 1;
                        padding: 6px;
                        border: 1px solid var(--vscode-input-border);
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border-radius: 4px;
                        font-size: 13px;
                        resize: none;
                    }
                    #sendButton {
                        margin-left: 8px;
                        padding: 6px 12px;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                    }
                    #sendButton:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                </style>
            </head>
            <body>
                <div id="messages"></div>
                <div id="inputArea">
                    <textarea id="messageInput" rows="2" placeholder="Ask me anything about your code..."></textarea>
                    <button id="sendButton">Send</button>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const messagesDiv = document.getElementById('messages');
                    const input = document.getElementById('messageInput');
                    const sendButton = document.getElementById('sendButton');
                    let thinkingDiv = null;

                    function addMessage(role, text) {
                        const div = document.createElement('div');
                        div.className = 'message ' + role;
                        div.textContent = text;
                        messagesDiv.appendChild(div);
                        messagesDiv.scrollTop = messagesDiv.scrollHeight;
                    }

                    function showThinking() {
                        thinkingDiv = document.createElement('div');
                        thinkingDiv.className = 'thinking';
                        thinkingDiv.textContent = 'Thinking...';
                        messagesDiv.appendChild(thinkingDiv);
                        messagesDiv.scrollTop = messagesDiv.scrollHeight;
                    }

                    function hideThinking() {
                        if (thinkingDiv) {
                            thinkingDiv.remove();
                            thinkingDiv = null;
                        }
                    }

                    function sendMessage() {
                        const text = input.value.trim();
                        if (!text) return;
                        vscode.postMessage({ type: 'sendMessage', text: text });
                        input.value = '';
                    }

                    sendButton.addEventListener('click', sendMessage);
                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage();
                        }
                    });

                    window.addEventListener('message', (event) => {
                        const message = event.data;
                        if (message.type === 'addMessage') {
                            addMessage(message.role, message.text);
                        } else if (message.type === 'showThinking') {
                            showThinking();
                        } else if (message.type === 'hideThinking') {
                            hideThinking();
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }
}