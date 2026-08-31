# Edit with PageSmith - macOS Launcher

A lightweight macOS app bundle that lets you open any HTML file in PageSmith with a double-click or right-click > "Open With".

## Installation

1. Copy `Edit with PageSmith.app` to your `/Applications` folder (or keep it on your Desktop)
2. Make sure Node.js is installed (`brew install node` or download from https://nodejs.org)

That's it - no other setup needed. PageSmith is fetched automatically via `npx`.

## Usage

**Drag and drop:** Drag any `.html` file onto the app icon.

**Right-click:** Right-click an HTML file > Open With > Edit with PageSmith.

**Double-click the app:** It will prompt you to pick an HTML file.

Once running:
- Your browser opens with the PageSmith editor
- Click any text to edit it
- Drag sections to rearrange
- Cmd+S saves changes back to the file
- Click "Stop PageSmith" in the dialog when you're done

## How It Works

The app is a simple bash script wrapped in a macOS `.app` bundle. It:

1. Finds `npx` on your system (checks Homebrew, system paths)
2. Starts PageSmith pointed at the directory containing your HTML file
3. Opens your browser to the editor
4. Shows a dialog to keep the server running
5. Cleans up when you click "Stop"

## Requirements

- macOS
- Node.js (v18+)
- An internet connection (first run only, to download PageSmith from npm)
