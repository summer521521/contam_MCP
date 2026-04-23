import argparse
import re
import sys
import time
from pathlib import Path

import win32con
import win32gui
from pywinauto import Application


def connect_main(process_name: str, class_name: str):
    app = Application(backend="win32").connect(path=process_name)
    main = app.window(class_name=class_name)
    return app, main


def dump_menu(items, prefix=""):
    for item in items:
        state = []
        try:
            if not item.is_enabled():
                state.append("disabled")
        except Exception:
            pass
        suffix = f" [{' ,'.join(state)}]" if state else ""
        print(f"{prefix}{item.text()}{suffix}")
        try:
            children = item.sub_menu().items()
        except Exception:
            children = []
        if children:
            dump_menu(children, prefix + "  ")


def snapshot_dialogs(app, main_handle: int):
    rows = []
    for w in app.windows():
        if w.handle == main_handle:
            continue
        rows.append((w.handle, w.window_text(), w.class_name()))
    return rows


def is_real_dialog(window, main_handle: int):
    if window.handle == main_handle:
        return False
    if window.class_name() != "#32770":
        return False
    title = window.window_text().strip()
    if title:
        return True
    for _, _, text, _ in visible_child_texts(window):
        if text.strip():
            return True
    return False


def visible_child_texts(window):
    rows = []
    for index, child in enumerate(window.children(), start=1):
        text = child.window_text()
        cls = child.class_name()
        if text or cls in ("Button", "Static", "Edit", "ComboBox", "#32770"):
            rows.append((index, cls, text, child))
    return rows


def open_menu_path(app, main, menu_path: str, wait_seconds: float):
    stale = [w for w in app.windows() if is_real_dialog(w, main.handle)]
    close_windows(stale)
    time.sleep(0.3)

    item = main.menu().get_menu_path(menu_path)[-1]
    before = {h for h, _, _ in snapshot_dialogs(app, main.handle)}
    win32gui.PostMessage(main.handle, win32con.WM_COMMAND, item.item_id(), 0)
    time.sleep(wait_seconds)
    dialogs = []
    for w in app.windows():
        if not is_real_dialog(w, main.handle):
            continue
        if w.handle not in before:
            dialogs.append(w)
    if not dialogs:
        dialogs = [w for w in app.windows() if is_real_dialog(w, main.handle)]
    return dialogs


def close_windows(windows):
    for w in windows:
        try:
            w.close()
        except Exception:
            pass


def click_child_button(dialog, button_text: str, button_index: int):
    match_index = 0
    for child in dialog.children():
        if child.class_name() != "Button":
            continue
        if child.window_text().strip() != button_text:
            continue
        match_index += 1
        if match_index != button_index:
            continue
        try:
            dialog.set_focus()
            child.click_input()
            return True
        except Exception:
            try:
                child.click()
                return True
            except Exception:
                return False
    return False


def parse_click_sequence(raw: str):
    sequence = []
    if not raw:
        return sequence
    for part in raw.split("|"):
        part = part.strip()
        if not part:
            continue
        if ":" in part:
            text, index = part.rsplit(":", 1)
            sequence.append((text.strip(), int(index)))
        else:
            sequence.append((part, 1))
    return sequence


def safe_name(text: str):
    text = text.strip() or "dialog"
    text = re.sub(r'[\\/:*?"<>|]+', "_", text)
    text = re.sub(r"\s+", "-", text)
    return text[:80]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--process", default="contamw3.exe")
    parser.add_argument("--class-name", default="CONTAMW3")
    parser.add_argument("--list-menu", action="store_true")
    parser.add_argument("--menu-path")
    parser.add_argument("--click-text")
    parser.add_argument("--click-index", type=int, default=1)
    parser.add_argument("--click-seq")
    parser.add_argument("--wait", type=float, default=1.0)
    parser.add_argument("--leave-open", action="store_true")
    parser.add_argument("--screenshot-dir")
    args = parser.parse_args()

    app, main = connect_main(args.process, args.class_name)

    if args.list_menu:
        dump_menu(main.menu().items())
        return 0

    if args.menu_path:
        dialogs = open_menu_path(app, main, args.menu_path, args.wait)
        if not dialogs:
            print("NO_DIALOG")
            return 0
        clicked = []
        click_sequence = parse_click_sequence(args.click_seq)
        if args.click_text:
            click_sequence.insert(0, (args.click_text, args.click_index))
        if click_sequence:
            targets = list(dialogs)
            for click_text, click_index in click_sequence:
                before = {h for h, _, _ in snapshot_dialogs(app, main.handle)}
                clicked_this_step = False
                for dlg in list(targets):
                    if click_child_button(dlg, click_text, click_index):
                        clicked.append(dlg.handle)
                        clicked_this_step = True
                        time.sleep(args.wait)
                        break
                if not clicked_this_step:
                    break
                newer = []
                for w in app.windows():
                    if not is_real_dialog(w, main.handle):
                        continue
                    if w.handle not in before:
                        newer.append(w)
                if newer:
                    targets = targets + newer
                    dialogs = targets
        for dlg in dialogs:
            rect = dlg.rectangle()
            print(f"TITLE: {dlg.window_text()}")
            print(f"HANDLE: {dlg.handle}")
            print(f"CLASS: {dlg.class_name()}")
            print(
                "RECT: "
                f"{rect.left},{rect.top},{rect.right},{rect.bottom} "
                f"SIZE: {rect.width()}x{rect.height()}"
            )
            if clicked and dlg.handle in clicked:
                print("CLICKED: yes")
            for index, cls, text, child in visible_child_texts(dlg):
                extra = ""
                if cls == "Button":
                    try:
                        extra = f" [enabled={child.is_enabled()}]"
                    except Exception:
                        extra = ""
                print(f"{index}:{cls}: {text}{extra}")
            if args.screenshot_dir:
                screenshot_dir = Path(args.screenshot_dir)
                screenshot_dir.mkdir(parents=True, exist_ok=True)
                path = screenshot_dir / f"{dlg.handle}-{safe_name(dlg.window_text())}.png"
                dlg.capture_as_image().save(path)
                print(f"SCREENSHOT: {path}")
            print("---")
        if not args.leave_open:
            close_windows(dialogs)
        return 0

    print("Nothing to do.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
