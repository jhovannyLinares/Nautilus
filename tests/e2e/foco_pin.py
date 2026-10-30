"""El campo de PIN tiene que recibir lo que se teclea sin hacer clic en los círculos:
al abrir el diálogo, al hacer clic en otra parte del diálogo y al volver a la ventana desde otra app.
Uso: python -I tests/e2e/foco_pin.py [pack]"""
import os, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = r"C:\Tools\output\Nautilus"
env = {k: v for k, v in os.environ.items() if k != "ELECTRON_RUN_AS_NODE"}
env["NAUTILUS_PROFILE"] = "foco" + str(int(time.time()))
CMD = [ROOT + r"\dist\win-unpacked\Nautilus.exe"] if sys.argv[1:] == ["pack"] else [ROOT + r"\node_modules\electron\dist\electron.exe", "."]
failures = 0

def check(label, cond):
    global failures
    failures += 0 if cond else 1
    print(("OK   " if cond else "FALLA") + " " + label)

def dots_on(page, scope):
    return page.locator(scope + " .pin-dot.on").count()

app = subprocess.Popen(CMD + ["--remote-debugging-port=9471"], cwd=ROOT, env=env)
try:
    with sync_playwright() as pw:
        browser = None
        for _ in range(60):
            try:
                browser = pw.chromium.connect_over_cdp("http://127.0.0.1:9471")
                break
            except Exception:
                time.sleep(0.25)  # la app todavía no abre el puerto
        page = None
        for _ in range(60):
            page = next((p for c in browser.contexts for p in c.pages if "index.html" in p.url), None)
            if page:
                break
            time.sleep(0.25)
        page.wait_for_selector(".lock")

        # pantalla de bloqueo, primera vez: se teclea sin clic
        page.keyboard.type("123456")
        first_field_dots = page.locator(".pin").nth(0).locator(".pin-dot.on").count()
        check("crear PIN: el primer campo recibe lo tecleado sin clic", first_field_dots == 6)
        page.keyboard.type("123456")  # completar el primero pasa solo al segundo, y completar el segundo envía
        page.wait_for_selector(".main")

        page.click("text=+ Nueva")
        page.keyboard.type("demo")
        page.fill("input[type=password]", "valor")
        page.click(".dialog-foot >> text=Guardar")
        page.wait_for_selector(".tr >> text=NAU_DEMO")

        # diálogo de PIN: se abre y se teclea directo
        page.click(".detail >> text=Mostrar")
        page.wait_for_selector(".dialog .pin")
        page.keyboard.type("12")
        check("diálogo de PIN: recibe lo tecleado al abrir", dots_on(page, ".dialog") == 2)

        # clic en una zona del diálogo que no es el campo
        page.click(".dialog .center-text")
        page.keyboard.type("3")
        check("diálogo de PIN: sigue recibiendo tras clic en el texto", dots_on(page, ".dialog") == 3)

        # la ventana pierde el foco (otra app) y lo recupera
        page.evaluate("document.activeElement && document.activeElement.blur(); window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus'))")
        page.keyboard.type("4")
        check("diálogo de PIN: sigue recibiendo al volver a la ventana", dots_on(page, ".dialog") == 4)

        page.keyboard.type("56")
        page.wait_for_selector(".value-box >> text=valor")
        check("al completar el PIN confirma solo y muestra el valor", True)

        # bloqueo: al volver a la ventana se puede teclear el PIN
        page.click(".toolbar >> text=Bloquear")
        page.wait_for_selector(".lock")
        page.evaluate("document.activeElement && document.activeElement.blur(); window.dispatchEvent(new Event('focus'))")
        page.keyboard.type("123456")
        page.wait_for_selector(".main")
        check("bloqueada: recibe el PIN al volver a la ventana y desbloquea sola", True)
        browser.close()
finally:
    if app.poll() is None:
        app.terminate()
        app.wait(timeout=15)
sys.exit(1 if failures else 0)
