import subprocess, time, os
from playwright.sync_api import sync_playwright

ROOT = r"C:\Tools\output\Nautilus"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "capturas")
os.makedirs(OUT, exist_ok=True)
env = {k: v for k, v in os.environ.items() if k != "ELECTRON_RUN_AS_NODE"}
env["NAUTILUS_PROFILE"] = "e2e" + str(int(time.time()))

def reg(name):
    r = subprocess.run(["reg", "query", r"HKCU\Environment", "/v", name], capture_output=True, text=True)
    return name in r.stdout

def check(label, cond):
    print(("OK   " if cond else "FALLA") + " " + label)

import sys
# sin argumento: Electron de desarrollo sobre la carpeta; con "pack": el ejecutable empaquetado
CMD = [ROOT + r"\dist\win-unpacked\Nautilus.exe"] if sys.argv[1:] == ["pack"] else [ROOT + r"\node_modules\electron\dist\electron.exe", "."]
print("ejecutable:", CMD[0])
p = subprocess.Popen(CMD + ["--remote-debugging-port=9471"], cwd=ROOT, env=env)
try:
    with sync_playwright() as pw:
        b = None
        for _ in range(60):
            try:
                b = pw.chromium.connect_over_cdp("http://127.0.0.1:9471"); break
            except Exception:
                time.sleep(0.25)
        pg = None
        for _ in range(60):
            pg = next((x for c in b.contexts for x in c.pages if "index.html" in x.url), None)
            if pg: break
            time.sleep(0.25)
        pg.wait_for_selector(".lock", timeout=15000)
        shot = lambda n: pg.screenshot(path=os.path.join(OUT, f"e2e_{n}.png"))

        # 1. primera vez: crear PIN
        check("pide crear PIN la primera vez", "Crea tu PIN" in pg.inner_text(".lock"))
        shot("1_crear_pin")
        ins = pg.locator(".pin-input")
        ins.nth(0).fill("123456"); ins.nth(1).fill("123456")  # completar el segundo envía solo
        pg.wait_for_selector(".main", timeout=10000)
        check("tras crear PIN queda desbloqueada", "Desbloqueada" in pg.inner_text(".topbar"))

        # 2. carpeta
        pg.click("text=+ Nueva carpeta")
        pg.fill(".dialog input >> nth=0", "Prueba E2E")
        pg.fill(".dialog input >> nth=1", "ee")
        check("vista previa del nombre", "NAU_EE_" in pg.inner_text(".dialog"))
        pg.click(".dialog >> text=Crear")
        pg.wait_for_selector(".folder.on >> text=Prueba E2E")

        # 3. variable
        pg.click("text=+ Nueva")
        pg.fill(".prefixed input", "demo valor")
        check("nombre se normaliza y muestra $env", "$env:NAU_EE_DEMO_VALOR" in pg.inner_text(".dialog"))
        pg.fill("input[type=password]", "valor-e2e-123")
        shot("2_nueva_variable")
        pg.click(".dialog >> text=Guardar")
        pg.wait_for_selector(".tr >> text=NAU_EE_DEMO_VALOR")
        check("estado Nueva y aviso de reiniciar", "Nueva" in pg.inner_text(".table") and "hace poco" in pg.inner_text(".list"))
        check("publicada en HKCU\\Environment", reg("NAU_EE_DEMO_VALOR"))
        shot("3_principal")

        # 4. mostrar con PIN (incorrecto y correcto)
        pg.click(".detail >> text=Mostrar")
        pg.locator(".dialog .pin-input").fill("999999")
        pg.wait_for_selector(".dialog .lock-error")
        check("PIN incorrecto avisa intentos", "te quedan 2 intentos" in pg.inner_text(".dialog"))
        pg.locator(".dialog .pin-input").fill("123456")
        pg.wait_for_selector(".value-box >> text=valor-e2e-123")
        check("Mostrar con PIN enseña el valor", True)
        shot("4_valor")

        # 5. cambiar código de carpeta renombra
        pg.click(".folder.on", button="right")
        pg.click(".ctx >> text=Editar")
        pg.fill(".dialog input >> nth=1", "ef")
        check("lista antes -> después", "NAU_EF_DEMO_VALOR" in pg.inner_text(".dialog .warn-box"))
        shot("5_renombrar")
        pg.click(".dialog >> text=Guardar y renombrar")
        pg.wait_for_selector(".tr >> text=NAU_EF_DEMO_VALOR")
        check("renombrada en el registro", reg("NAU_EF_DEMO_VALOR") and not reg("NAU_EE_DEMO_VALOR"))

        # 6. bloquear / desbloquear
        pg.click(".toolbar >> text=Bloquear")
        pg.wait_for_selector(".lock")
        check("bloquear retira del registro", not reg("NAU_EF_DEMO_VALOR"))
        shot("6_bloqueada")
        pg.locator(".pin-input").fill("123456")
        pg.wait_for_selector(".main")
        check("desbloquear vuelve a publicar", reg("NAU_EF_DEMO_VALOR"))

        # 7. borrar carpeta eliminando
        pg.click(".folder >> text=Prueba E2E", button="right")
        pg.click(".ctx >> text=Borrar")
        pg.click(".option >> text=Eliminarlas")
        pg.click(".dialog-foot >> text=Borrar carpeta")
        pg.wait_for_selector(".folder >> text=Prueba E2E", state="detached")
        shot("7_tras_borrar")
        check("borrar carpeta elimina y retira", not reg("NAU_EF_DEMO_VALOR"))
        # 8. cerrar Nautilus retira lo publicado
        pg.click("text=+ Nueva")
        pg.fill(".prefixed input", "cierre")
        pg.fill("input[type=password]", "x")
        pg.click(".dialog-foot >> text=Guardar")
        pg.wait_for_selector(".tr >> text=NAU_CIERRE")
        check("publicada antes de cerrar", reg("NAU_CIERRE"))
        try:
            pg.evaluate("window.close()")
        except Exception as closed:
            # cerrar la ventana corta la conexión con la página: es el resultado esperado, no un fallo
            print("ventana cerrada:", type(closed).__name__)
        p.wait(timeout=15)
        check("cerrar la ventana retira lo publicado", not reg("NAU_CIERRE"))
finally:
    if p.poll() is None:
        p.terminate()
        p.wait(timeout=15)
