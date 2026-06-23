import * as fs from 'fs';
import * as path from 'path';

export interface RelatedFile {
    filePath: string;
    content: string;
}

/**
 * Detects the programming language based on file extension
 */
export function detectLanguage(filePath: string): 'javascript' | 'typescript' | 'python' | 'java' | 'unknown' {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.js' || ext === '.jsx'){ return 'javascript';}
    if (ext === '.ts' || ext === '.tsx') {return 'typescript';}
    if (ext === '.py'){ return 'python';}
    if (ext === '.java'){ return 'java';}
    return 'unknown';
}

/**
 * Main entry point: given a file's path and content, find related files
 */
export function findRelatedFiles(currentFilePath: string, fileContent: string): RelatedFile[] {
    const language = detectLanguage(currentFilePath);
    const baseDir = path.dirname(currentFilePath);

    let importPaths: string[] = [];

    if (language === 'javascript' || language === 'typescript') {
        importPaths = extractJsTsImports(fileContent);
        return resolveJsTsImports(importPaths, baseDir);
    } else if (language === 'python') {
        importPaths = extractPythonImports(fileContent);
        return resolvePythonImports(importPaths, baseDir);
    } else if (language === 'java') {
        importPaths = extractJavaImports(fileContent);
        return resolveJavaImports(importPaths, baseDir);
    }

    return [];
}

// ---------- JAVASCRIPT / TYPESCRIPT ----------

function extractJsTsImports(content: string): string[] {
    const importPaths: string[] = [];

    // Matches: import x from './file'  or import { x } from "../file"
    const importRegex = /import\s+(?:.+\s+from\s+)?['"](.+?)['"]/g;
    // Matches: require('./file')
    const requireRegex = /require\(['"](.+?)['"]\)/g;

    let match;
    while ((match = importRegex.exec(content)) !== null) {
        importPaths.push(match[1]);
    }
    while ((match = requireRegex.exec(content)) !== null) {
        importPaths.push(match[1]);
    }

    // Only keep relative imports (./  or ../), skip node_modules packages
    return importPaths.filter(p => p.startsWith('.'));
}

function resolveJsTsImports(importPaths: string[], baseDir: string): RelatedFile[] {
    const results: RelatedFile[] = [];
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];

    for (const importPath of importPaths) {
        const resolvedBase = path.resolve(baseDir, importPath);

        // Try exact path first, then try adding extensions, then try index files
        const candidates = [
            resolvedBase,
            ...extensions.map(ext => resolvedBase + ext),
            ...extensions.map(ext => path.join(resolvedBase, 'index' + ext))
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                try {
                    const content = fs.readFileSync(candidate, 'utf-8');
                    results.push({ filePath: candidate, content });
                } catch (err) {
                    console.error(`Failed to read ${candidate}:`, err);
                }
                break; // Found a valid file, stop trying other candidates
            }
        }
    }

    return results;
}

// ---------- PYTHON ----------

function extractPythonImports(content: string): string[] {
    const importPaths: string[] = [];

    // Matches: from module import x  OR  from .module import x
    const fromImportRegex = /from\s+(\.+\w[\w.]*|\.+)\s+import/g;
    // Matches: import module
    const importRegex = /^import\s+(\w[\w.]*)/gm;

    let match;
    while ((match = fromImportRegex.exec(content)) !== null) {
        importPaths.push(match[1]);
    }
    while ((match = importRegex.exec(content)) !== null) {
        importPaths.push(match[1]);
    }

    return importPaths;
}

function resolvePythonImports(importPaths: string[], baseDir: string): RelatedFile[] {
    const results: RelatedFile[] = [];

    for (const importPath of importPaths) {
        // Convert dots to path separators: e.g. ".utils.helpers" -> "utils/helpers"
        // Only handle relative imports (starting with .) for now, since absolute
        // imports require knowing the project's root/package structure
        if (!importPath.startsWith('.')) {
            continue;
        }

        const relativePath = importPath.replace(/^\.+/, '').replace(/\./g, path.sep);
        const resolvedBase = path.resolve(baseDir, relativePath);

        const candidates = [
            resolvedBase + '.py',
            path.join(resolvedBase, '__init__.py')
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                try {
                    const content = fs.readFileSync(candidate, 'utf-8');
                    results.push({ filePath: candidate, content });
                } catch (err) {
                    console.error(`Failed to read ${candidate}:`, err);
                }
                break;
            }
        }
    }

    return results;
}

// ---------- JAVA ----------

function extractJavaImports(content: string): string[] {
    const importPaths: string[] = [];

    // Matches: import com.example.ClassName;
    const importRegex = /import\s+([\w.]+);/g;

    let match;
    while ((match = importRegex.exec(content)) !== null) {
        importPaths.push(match[1]);
    }

    return importPaths;
}

function resolveJavaImports(importPaths: string[], baseDir: string): RelatedFile[] {
    const results: RelatedFile[] = [];

    // Java imports are package-based (e.g. com.example.MyClass), not relative file paths.
    // True resolution needs classpath/build info. As a best-effort approach, we search
    // upward from baseDir to find a matching .java file by class name only.
    for (const importPath of importPaths) {
        const parts = importPath.split('.');
        const className = parts[parts.length - 1];

        // Skip standard library imports (java.*, javax.*) since we can't resolve those locally
        if (importPath.startsWith('java.') || importPath.startsWith('javax.')) {
            continue;
        }

        const found = searchForJavaFile(baseDir, className + '.java', 3); // search up to 3 levels
        if (found) {
            try {
                const content = fs.readFileSync(found, 'utf-8');
                results.push({ filePath: found, content });
            } catch (err) {
                console.error(`Failed to read ${found}:`, err);
            }
        }
    }

    return results;
}

function searchForJavaFile(startDir: string, fileName: string, maxDepthUp: number): string | null {
    let currentDir = startDir;

    for (let i = 0; i < maxDepthUp; i++) {
        const found = searchDirRecursive(currentDir, fileName, 4); // limit recursion depth downward too
        if (found) {return found;}
        currentDir = path.dirname(currentDir);
    }

    return null;
}

function searchDirRecursive(dir: string, fileName: string, depth: number): string | null {
    if (depth <= 0){ return null;}

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return null;
    }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === fileName) {
            return fullPath;
        }
        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
            const result = searchDirRecursive(fullPath, fileName, depth - 1);
            if (result) {return result;}
        
        }
    }

    return null;
}