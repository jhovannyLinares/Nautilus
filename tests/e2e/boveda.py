"""Flujo de la barra de menús: qué abre cada opción, qué se habilita y el paso siguiente de cada cuadro. Incluye
Configuración (PIN para mostrar y copiar) y «Mostrar» al editar una variable.
No compara valores: exportar, importar, vaciar y la opción del PIN se prueban en vitest (tests/integration/vault.test.ts).
Uso: python -I tests/e2e/boveda.py [pack]"""
import base64, hashlib, json, os, subprocess, sys, tempfile, time
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from playwright.sync_api import sync_playwright

ROOT = r"C:\Tools\output\Nautilus"
PIN = "123456"
FILE_PASSWORD = "contraseña-del-archivo-e2e"
SCRYPT = {"N": 2 ** 15, "r": 8, "p": 1}
SCRYPT_MAX_MEMORY = 64 * 1024 * 1024
POLL_SECONDS = 0.25
POLL_ATTEMPTS = 60
env = {k: v for k, v in os.environ.items() if k != "ELECTRON_RUN_AS_NODE"}
env["NAUTILUS_PROFILE"] = "boveda" + str(int(time.time()))
CMD = [ROOT + r"\dist\win-unpacked\Nautilus.exe"] if sys.argv[1:] == ["pack"] else [ROOT + r"\node_modules\electron\dist\electron.exe", "."]
failures = 0


def check(label, cond):
    global failures
    failures += 0 if cond else 1
    print(("OK   " if cond else "FALLA") + " " + label)


def b64(raw):
    return base64.b64encode(raw).decode()


def encrypted_nau(content, password, exported_at):
    """Un .nau cifrado con el mismo formato que src/backend/export-file.ts, para tener qué importar sin el diálogo de Windows."""
    salt, iv = os.urandom(16), os.urandom(12)
    key = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT["N"], r=SCRYPT["r"], p=SCRYPT["p"], maxmem=SCRYPT_MAX_MEMORY, dklen=32)
    header = {"format": "nautilus-export", "version": 1, "exportedAt": exported_at, "variables": len(content["vars"]), "folders": len(content["folders"]), "encrypted": True}
    kdf = {"name": "scrypt", **SCRYPT, "salt": b64(salt)}
    aad = json.dumps([*header.values(), kdf["name"], kdf["N"], kdf["r"], kdf["p"], kdf["salt"]], separators=(",", ":"), ensure_ascii=False).encode()
    sealed = AESGCM(key).encrypt(iv, json.dumps(content).encode(), aad)
    return json.dumps({**header, "kdf": kdf, "iv": b64(iv), "tag": b64(sealed[-16:]), "data": b64(sealed[:-16])})


def drop_file(page, selector, path):
    """Suelta un archivo real sobre la zona: CDP arma el File con su ruta, como un arrastre desde el Explorador."""
    box = page.locator(selector).bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    cdp = page.context.new_cdp_session(page)
    data = {"items": [], "files": [path], "dragOperationsMask": 1}
    for event_type in ("dragEnter", "dragOver", "drop"):
        cdp.send("Input.dispatchDragEvent", {"type": event_type, "x": x, "y": y, "data": data})


def open_menu(page, title):
    page.click(".menubar-title >> text=" + title)
    page.wait_for_selector(".menubar-panel")


def open_menu_item(page, title, label):
    open_menu(page, title)
    page.click(".menubar-panel >> text=" + label)
    page.wait_for_selector(".dialog")


def foot_button(page, label):
    return page.locator(".dialog-foot button", has_text=label)


import_file = os.path.join(tempfile.mkdtemp(prefix="nautilus-e2e-"), "import.nau")
content = {
    "folders": [{"name": "General", "code": "", "color": "#4d88ff"}, {"name": "Colombia", "code": "CO", "color": "#e8743b"}],
    "vars": [
        {"folderCode": "", "short": "DEMO", "value": "otro-valor", "publish": False, "expires": None},
        {"folderCode": "CO", "short": "INSIS_PASS", "value": "nuevo", "publish": False, "expires": None},
    ],
}
with open(import_file, "w", encoding="utf-8") as handle:
    handle.write(encrypted_nau(content, FILE_PASSWORD, "2026-10-29T08:40:00.000Z"))

app = subprocess.Popen(CMD + ["--remote-debugging-port=9471"], cwd=ROOT, env=env)
try:
    with sync_playwright() as pw:
        browser = None
        for _ in range(POLL_ATTEMPTS):
            try:
                browser = pw.chromium.connect_over_cdp("http://127.0.0.1:9471")
                break
            except Exception:
                time.sleep(POLL_SECONDS)  # la app todavía no abre el puerto
        page = None
        for _ in range(POLL_ATTEMPTS):
            page = next((p for c in browser.contexts for p in c.pages if "index.html" in p.url), None)
            if page:
                break
            time.sleep(POLL_SECONDS)
        page.wait_for_selector(".lock")
        page.keyboard.type(PIN)
        page.keyboard.type(PIN)
        page.wait_for_selector(".main")

        # una variable para que haya algo que exportar y algo con que chocar al importar
        page.click("text=+ Nueva")
        page.keyboard.type("demo")
        page.fill("input[type=password]", "valor")
        page.click(".dialog-foot >> text=Guardar")
        page.wait_for_selector(".tr >> text=NAU_DEMO")

        # ---------- la barra de menús ----------
        titles = page.locator(".menubar-title").all_inner_texts()
        check("la barra muestra Archivo, Editar, Ver, Herramientas y Ayuda", titles == ["Archivo", "Editar", "Ver", "Herramientas", "Ayuda"])
        open_menu(page, "Archivo")
        items = page.locator(".menubar-panel [role=menuitem]").all_inner_texts()
        check("Archivo trae Importar y Exportar", any(i.startswith("Importar") for i in items) and any(i.startswith("Exportar") for i in items))
        panel_box = page.locator(".menubar-panel").bounding_box()
        item_boxes = [b.bounding_box() for b in page.locator(".menubar-panel [role=menuitem]").all()]
        check("cada opción va en su fila y dentro del recuadro",
              all(box["x"] >= panel_box["x"] and box["x"] + box["width"] <= panel_box["x"] + panel_box["width"] + 1 for box in item_boxes)
              and all(later["y"] > earlier["y"] for earlier, later in zip(item_boxes, item_boxes[1:])))
        page.hover(".menubar-title >> text=Herramientas")
        page.wait_for_selector(".menubar-panel >> text=Vaciar la bóveda…")
        check("con un menú abierto, pasar el mouse abre el vecino", page.locator(".menubar-panel").count() == 1)
        page.keyboard.press("Escape")
        page.wait_for_selector(".menubar-panel", state="detached")
        check("Escape cierra el menú", True)
        open_menu(page, "Archivo")
        page.click(".statusbar-right")
        page.wait_for_selector(".menubar-panel", state="detached")
        check("un clic fuera cierra el menú", True)

        # ---------- exportar ----------
        open_menu_item(page, "Archivo", "Exportar variables…")
        export_button = foot_button(page, "Exportar 1 variable")
        check("Exportar abre su cuadro con el botón apagado hasta poner contraseña", page.locator(".dialog-title").inner_text() == "Exportar variables" and export_button.is_disabled())
        page.click(".dialog >> text=Con valores, en texto plano (.env)")
        page.wait_for_selector(".dialog .danger-box")
        file_field = page.locator(".dialog input[aria-label=Archivo]")
        check("texto plano: sin contraseña, con el aviso rojo, archivo .env y el botón encendido",
              page.locator(".dialog >> text=CONTRASEÑA DEL ARCHIVO").count() == 0 and file_field.input_value().endswith(".env") and export_button.is_enabled())
        page.click(".dialog >> text=Con valores, cifrados con una contraseña")
        page.locator(".dialog input[type=password]").first.fill("corta")
        page.wait_for_selector(".dialog .error-line >> text=al menos 12")
        check("cifrado: archivo .nau y aviso con una contraseña corta", file_field.input_value().endswith(".nau"))
        page.click(".dialog >> text=Generar")
        check("Generar llena las dos y enciende el botón", export_button.is_enabled() and page.locator(".dialog .error-line").count() == 0)
        export_button.click()
        page.wait_for_selector(".dialog >> text=Confirma con tu PIN")
        check("Exportar pasa a pedir el PIN", foot_button(page, "Confirmar").count() == 1)
        page.keyboard.press("Escape")
        page.wait_for_selector(".dialog", state="detached")

        # ---------- importar ----------
        open_menu_item(page, "Archivo", "Importar variables…")
        preview_button = foot_button(page, "Ver qué se importa")
        check("Importar abre con «Ver qué se importa» apagado", preview_button.is_disabled())
        drop_file(page, ".drop-zone", import_file)
        page.wait_for_selector(".dialog .kv-box >> text=import.nau")
        check("soltar el archivo muestra lo que contiene", "2 variables en 2 carpetas · con valores cifrados" in page.locator(".dialog .kv-box").inner_text())
        check("cifrado: pide la contraseña antes de seguir", preview_button.is_disabled())
        page.locator(".dialog input[type=password]").fill(FILE_PASSWORD)
        preview_button.click()
        page.wait_for_selector(".dialog .import-table")
        badges = page.locator(".dialog .badge").all_inner_texts()
        check("la vista previa resume nuevas, con otro valor y carpetas nuevas", {"1 nueva", "1 con otro valor", "1 carpeta nueva"} <= set(badges))
        check("la nueva dice que crea su carpeta", page.locator(".dialog >> text=Crea la carpeta Colombia (CO)").count() == 1)
        check("por defecto conserva la actual", foot_button(page, "Importar 1").inner_text() == "Importar 1")
        page.click(".dialog >> text=Reemplazar")
        check("elegir Reemplazar cambia el botón", foot_button(page, "Importar 1 y reemplazar 1").count() == 1)
        foot_button(page, "Importar 1 y reemplazar 1").click()
        page.wait_for_selector(".dialog >> text=Confirma con tu PIN")
        page.keyboard.type(PIN)
        page.wait_for_selector(".dialog", state="detached", timeout=60_000)
        page.wait_for_selector(".toast >> text=Importadas")
        check("con el PIN importa, cierra el cuadro y avisa", page.locator(".tr >> text=NAU_CO_INSIS_PASS").count() == 1)

        # ---------- «Mostrar» al editar, con el PIN ----------
        page.click(".tr >> text=NAU_DEMO")
        page.keyboard.press("F2")
        page.wait_for_selector(".dialog-title >> text=Editar variable")
        check("F2 edita la variable elegida", True)
        page.click(".dialog >> button:text-is('Mostrar')")
        page.wait_for_selector(".dialog .pin-strip")
        check("al editar, «Mostrar» pide el PIN", True)
        page.keyboard.type(PIN)
        page.wait_for_selector(".dialog .pin-strip", state="detached")
        check("con el PIN trae el valor guardado y lo deja visible",
              page.locator(".dialog >> text=Es el valor guardado").count() == 1 and page.locator(".dialog >> button:text-is('Ocultar')").count() == 1)
        page.keyboard.press("Escape")
        page.wait_for_selector(".dialog", state="detached")

        # ---------- configuración: apagar el PIN para mostrar y copiar ----------
        page.keyboard.press("Control+,")
        page.wait_for_selector(".dialog-title >> text=Configuración")
        check("Ctrl+, abre Configuración", True)
        page.keyboard.press("Escape")
        page.wait_for_selector(".dialog", state="detached")
        open_menu_item(page, "Herramientas", "Configuración…")
        save_button = foot_button(page, "Guardar")
        page.click(".dialog >> text=Pedir el PIN para mostrar o copiar un valor")
        page.wait_for_selector(".dialog .warn-box")
        check("apagarla avisa y apaga Guardar hasta confirmar el PIN", save_button.is_disabled())
        page.keyboard.type(PIN)
        check("con el PIN se enciende Guardar", save_button.is_enabled())
        save_button.click()
        page.wait_for_selector(".dialog", state="detached")
        page.click(".tr >> text=NAU_DEMO")
        page.click(".detail >> button:text-is('Mostrar')")
        page.wait_for_selector(".detail >> button:text-is('Ocultar')")
        check("apagada, el detalle muestra el valor sin pedir el PIN", page.locator(".dialog").count() == 0)
        page.keyboard.press("F2")
        page.wait_for_selector(".dialog-title >> text=Editar variable")
        page.click(".dialog >> button:text-is('Mostrar')")
        page.wait_for_selector(".dialog >> text=Es el valor guardado")
        check("apagada, al editar «Mostrar» trae el valor sin pedir el PIN", page.locator(".dialog .pin-strip").count() == 0)
        page.keyboard.press("Escape")
        page.wait_for_selector(".dialog", state="detached")

        # ---------- vaciar ----------
        open_menu_item(page, "Herramientas", "Vaciar la bóveda…")
        wipe_button = foot_button(page, "Vaciar la bóveda")
        check("Vaciar abre con el botón apagado", wipe_button.is_disabled())
        page.click(".dialog >> text=Exportar primero")
        page.wait_for_selector(".dialog-title >> text=Exportar variables")
        check("«Exportar primero» abre Exportar", True)
        page.keyboard.press("Escape")
        page.wait_for_selector(".dialog", state="detached")
        open_menu_item(page, "Herramientas", "Vaciar la bóveda…")
        page.locator(".dialog input[aria-label='Escribe VACIAR para confirmar']").fill("vaciar")
        check("escribir VACIAR enciende el botón", wipe_button.is_enabled())
        wipe_button.click()
        page.wait_for_selector(".dialog >> text=Confirma con tu PIN")
        page.keyboard.type(PIN)
        page.wait_for_selector(".dialog", state="detached", timeout=60_000)
        page.wait_for_selector(".empty >> text=Sin variables todavía")
        check("con el PIN vacía, cierra el cuadro y la lista queda vacía", True)
        browser.close()
finally:
    if app.poll() is None:
        app.terminate()
        app.wait(timeout=15)
sys.exit(1 if failures else 0)
