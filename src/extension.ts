import { ChatViewProvider } from './chatViewProvider';
import { findRelatedFiles } from './importParser';
import * as vscode from 'vscode';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export function activate(context: vscode.ExtensionContext) {

	console.log('AI Pair Programmer is now active!');

	// Command: Explain Code
	const explainCommand = vscode.commands.registerCommand('ai-pair-programmer.explainCode', async () => {
		const editor = vscode.window.activeTextEditor;

		if (!editor) {
			vscode.window.showErrorMessage('No active editor found.');
			return;
		}

		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);

		if (!selectedText) {
			vscode.window.showErrorMessage('Please select some code to explain.');
			return;
		}

		const currentFilePath = editor.document.uri.fsPath;
		const fullFileContent = editor.document.getText();
		const relatedFiles = findRelatedFiles(currentFilePath, fullFileContent);

		let contextSection = '';
		if (relatedFiles.length > 0) {
			contextSection = '\n\nHere is related context from files this code depends on:\n\n';
			for (const file of relatedFiles) {
				contextSection += `--- ${path.basename(file.filePath)} ---\n${file.content}\n\n`;
			}
		}

		if (!GROQ_API_KEY) {
			vscode.window.showErrorMessage('Groq API key not found. Check your .env file.');
			return;
		}

		vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Explaining code...',
				cancellable: false
			},
			async () => {
				try {
					const response = await axios.post(
						GROQ_API_URL,
						{
							model: 'llama-3.1-8b-instant',
							messages: [
								{
									role: 'system',
									content: 'You are a helpful coding assistant. Explain the given code clearly and concisely in plain language, suitable for a developer trying to understand it quickly.'
								},
								{
									role: 'user',
									content: `Explain this code:\n\n${selectedText}${contextSection}`
								}
							],
							temperature: 0.3
						},
						{
							headers: {
								'Authorization': `Bearer ${GROQ_API_KEY}`,
								'Content-Type': 'application/json'
							}
						}
					);

					const explanation = response.data.choices[0].message.content;

					const panel = vscode.window.createWebviewPanel(
						'codeExplanation',
						'Code Explanation',
						vscode.ViewColumn.Beside,
						{}
					);

					panel.webview.html = getWebviewContent(explanation, 'Code Explanation');

				} catch (error: any) {
					console.error(error);
					vscode.window.showErrorMessage(
						`Error calling Groq API: ${error.message || 'Unknown error'}`
					);
				}
			}
		);
	});

	context.subscriptions.push(explainCommand);

	// Command: Fix Error
	const fixErrorCommand = vscode.commands.registerCommand('ai-pair-programmer.fixError', async () => {
		const editor = vscode.window.activeTextEditor;

		if (!editor) {
			vscode.window.showErrorMessage('No active editor found.');
			return;
		}

		const cursorPosition = editor.selection.active;
		const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);

		const relevantDiagnostic = diagnostics.find(d => d.range.contains(cursorPosition));

		if (!relevantDiagnostic) {
			vscode.window.showErrorMessage('No error found at cursor position. Click on a line with an error first.');
			return;
		}

		const errorMessage = relevantDiagnostic.message;
		const errorLine = relevantDiagnostic.range.start.line;

		const startLine = Math.max(0, errorLine - 5);
		const endLine = Math.min(editor.document.lineCount - 1, errorLine + 5);
		const surroundingCode = editor.document.getText(
			new vscode.Range(startLine, 0, endLine, editor.document.lineAt(endLine).text.length)
		);

		if (!GROQ_API_KEY) {
			vscode.window.showErrorMessage('Groq API key not found. Check your .env file.');
			return;
		}

		vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Diagnosing error...',
				cancellable: false
			},
			async () => {
				try {
					const response = await axios.post(
						GROQ_API_URL,
						{
							model: 'llama-3.1-8b-instant',
							messages: [
								{
									role: 'system',
									content: 'You are a helpful coding assistant. Given an error message and surrounding code, explain what is causing the error in plain language, then provide a corrected version of the code.'
								},
								{
									role: 'user',
									content: `I'm getting this error:\n"${errorMessage}"\n\nHere is the surrounding code:\n\n${surroundingCode}\n\nPlease explain what's wrong and show me the fix.`
								}
							],
							temperature: 0.3
						},
						{
							headers: {
								'Authorization': `Bearer ${GROQ_API_KEY}`,
								'Content-Type': 'application/json'
							}
						}
					);

					const fixSuggestion = response.data.choices[0].message.content;

					const panel = vscode.window.createWebviewPanel(
						'errorFix',
						'Error Diagnosis & Fix',
						vscode.ViewColumn.Beside,
						{}
					);

					panel.webview.html = getWebviewContent(fixSuggestion, 'Error Diagnosis & Fix');

				} catch (error: any) {
					console.error(error);
					vscode.window.showErrorMessage(
						`Error calling Groq API: ${error.message || 'Unknown error'}`
					);
				}
			}
		);
	});

	context.subscriptions.push(fixErrorCommand);

	// Chat Sidebar Panel
	const chatProvider = new ChatViewProvider(GROQ_API_KEY, GROQ_API_URL);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider)
	);
}

function getWebviewContent(content: string, title: string): string {
	const escaped = content
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');

	return `
		<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<style>
				body {
					font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
					padding: 20px;
					line-height: 1.6;
					font-size: 14px;
				}
				pre {
					white-space: pre-wrap;
					word-wrap: break-word;
				}
			</style>
		</head>
		<body>
			<h2>${title}</h2>
			<pre>${escaped}</pre>
		</body>
		</html>
	`;
}

export function deactivate() {}