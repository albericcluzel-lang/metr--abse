import http.server
import itertools
import json
import threading
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")
cv2 = pytest.importorskip("cv2")

from rendu_ia import __main__ as cli  # noqa: E402
from rendu_ia import film, montage, retouche  # noqa: E402
from rendu_ia.config import ConfigError  # noqa: E402

from .conftest import make_image  # noqa: E402


def run(*args) -> int:
    return cli.main([str(arg) for arg in args])


def room(width=320, height=180, window=True) -> np.ndarray:
    """Pièce de synthèse : mur gris uni, sol plus sombre, fenêtre claire à gauche."""
    image = np.full((height, width, 3), 120, np.uint8)
    image[height * 2 // 3:] = (70, 80, 95)
    if window:
        image[height // 5:height // 2, width // 12:width // 4] = 250
    return image


def save(path, image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), image)


def test_retouch_doubles_a_small_capture_and_only_finishes_a_3d_render():
    capture = room()
    retouched = retouche.retouch(capture, seed=3)
    assert retouched.shape == (360, 640, 3) and retouched.dtype == np.uint8
    assert np.array_equal(retouched, retouche.retouch(capture, seed=3))     # même vue, même résultat
    finished = retouche.retouch(capture, seed=3, finish=True)
    assert finished.shape == capture.shape
    # La finition garde la lumière et les couleurs du rendu : le mur ne bouge presque pas.
    wall = (slice(60, 110), slice(200, 300))
    assert abs(float(finished[wall].mean()) - float(capture[wall].mean())) < 6
    large = retouche.retouch(room(2800, 1200), seed=1)
    assert large.shape == (1200, 2800, 3)                                    # déjà grande : pas d'agrandissement


def test_light_falls_off_away_from_the_window():
    image = room().astype(np.float32) / 255
    field = retouche.light_field(image)
    assert field[60, 60] > 0.5 > field[60, 300]
    lit = retouche.relight(image, unit=0.1)
    assert lit[100, 110].mean() > lit[100, 300].mean()                       # même mur, plus clair près de la fenêtre
    dark = room(window=False).astype(np.float32) / 255
    assert float(retouche.light_field(dark).max()) == 0                      # pas de source : rien n'est inventé


def test_film_plan_is_read_from_plain_french_lines(tmp_path):
    images = [tmp_path / "1_couloir.jpg", tmp_path / "2_salon.png"]
    shots = film.parse_plan("# commentaire\n2_salon : Arrière\n\n1_couloir : avant vers 45,42  # vers le fond\n", images)
    assert shots == [film.Shot(images[1], "arriere"), film.Shot(images[0], "avant", (0.45, 0.42))]
    assert film.parse_plan(film.format_plan(shots), images) == shots         # le plan écrit se relit tel quel
    for text, message in [("3_cuisine : avant", "vue « 3_cuisine » inconnue"), ("2_salon : zoom", "non compris"),
                          ("2_salon", "non compris"), ("# rien", "aucun plan")]:
        with pytest.raises(ConfigError, match=message):
            film.parse_plan(text, images)


@pytest.mark.parametrize("size, ratio", list(itertools.product(
    [(1920, 804), (1526, 784), (1600, 1200), (900, 1600)], film.FORMATS.values())))
def test_camera_never_leaves_the_image(size, ratio, tmp_path):
    out = film.frame_size(ratio, 640)
    camera = film.Camera(*size, *out)
    for move, target in [(move, None) for move in film.MOVES] + [("avant", (0.05, 0.95)), ("arriere", (0.9, 0.1))]:
        (start, zoom0), (end, zoom1) = film.camera_path(camera, film.Shot(tmp_path / "vue.jpg", move, target))
        for step in range(11):
            t = step / 10
            look = (start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t)
            assert camera.inside(look, zoom0 + (zoom1 - zoom0) * t), (move, target, t)
    left, right = film.camera_path(camera, film.Shot(tmp_path / "vue.jpg", "gauche"))
    assert left[0][0] > right[0][0]                                          # « gauche » : la caméra tourne à gauche


def test_centre_of_the_image_stays_put_and_a_turn_reprojects_it():
    camera = film.Camera(1600, 900, 640, 268)
    centre = camera.matrix(camera.centre, 1.0) @ np.array([800, 450, 1.0])
    assert np.allclose(centre[:2] / centre[2], (320, 134))
    turned = camera.matrix((900, 450), 1.2)
    aim = turned @ np.array([900, 450, 1.0])
    assert np.allclose(aim[:2] / aim[2], (320, 134))                         # le point visé vient au milieu du cadre
    assert abs(turned[2, 0]) > 1e-6                                          # vraie rotation : les fuyantes bougent


def test_film_is_rendered_with_the_expected_length_and_size(tmp_path):
    pytest.importorskip("imageio_ffmpeg")
    for name, image in [("1_entree.png", room()), ("2_salon.png", room(400, 180)), ("3_chambre.png", room(window=False))]:
        save(tmp_path / name, image)
    shots = film.automatic_plan(sorted(tmp_path.glob("*.png")))
    assert [shot.move for shot in shots] == ["avant", "avant", "arriere"]
    assert shots[0].target[0] < 0.5                                          # la caméra avance vers la fenêtre
    seen = []
    seconds = film.render(shots, tmp_path / "film.mp4", width=320, fps=8, seconds=1.0, dissolve=0.25,
                          progress=lambda done, total: seen.append((done, total)))
    assert seconds == pytest.approx(2.5) and seen[-1] == (20, 20)
    clip = montage.probe(montage.ffmpeg_exe(), tmp_path / "film.mp4")
    assert (clip.width, clip.height) == (320, 134) and clip.seconds == pytest.approx(2.5, abs=0.2)
    assert not list(tmp_path.glob("*.tmp"))


def test_retouche_then_film_from_the_command_line(project, monkeypatch, capsys):
    pytest.importorskip("imageio_ffmpeg")
    monkeypatch.setattr(film, "WIDTH", 256)
    monkeypatch.setattr(film, "FPS", 6)
    save(project.root / "captures" / "salon.png", room())
    save(project.root / "captures" / "cuisine.jpg", room(window=False))
    assert run("retouche", project.root) == 0
    assert (project.output / "retouches" / "salon.jpg").is_file()
    assert "2 vue(s) retouchée(s)" in capsys.readouterr().out
    assert run("retouche", project.root) == 0
    assert "2 déjà fait(s)" in capsys.readouterr().out

    make_image(project.output / "rendus" / "cuisine.png", size=(320, 180))    # un rendu passe avant la retouche
    assert run("film", project.root, "--duree-plan", "2", "--fondu", "0,5") == 0
    out = capsys.readouterr().out
    assert "1. cuisine.png (rendu)" in out and "2. salon.jpg (retouche)" in out and "Film prêt" in out
    assert (project.output / "film.mp4").is_file()
    plan = project.root / "film.txt"
    assert "cuisine : avant" in plan.read_text(encoding="utf-8")
    assert run("etat", project.root) == 0
    assert "retouches à jour : 2/2 ; film : à jour" in capsys.readouterr().out

    plan.write_text("salon : droite\n", encoding="utf-8-sig")                 # comme l'enregistre le Bloc-notes
    assert run("film", project.root, "--duree-plan", "2", "--format", "16/9", "--sortie", project.root / "essai.mp4") == 0
    out = capsys.readouterr().out
    assert "laissées de côté : cuisine" in out and "1. salon.jpg (retouche) : droite" in out
    clip = montage.probe(montage.ffmpeg_exe(), project.root / "essai.mp4")
    assert (clip.width, clip.height) == (256, 144)

    plan.write_text("salon : travelling\n", encoding="utf-8")
    assert run("film", project.root) == 1
    assert "non compris" in capsys.readouterr().err
    assert run("etat", project.root) == 0
    assert "film : à faire" in capsys.readouterr().out                        # le plan a changé depuis le film


def test_film_refuses_videos_and_empty_projects(project, tmp_path, capsys):
    clip = tmp_path / "visite.mp4"
    clip.write_bytes(b"0")
    assert run("film", project.root, clip) == 1
    assert "montage" in capsys.readouterr().err
    for capture in (project.root / "captures").glob("*.*"):
        capture.unlink()
    assert run("film", project.root) == 1 and run("retouche", project.root) == 1
    assert "Aucune" in capsys.readouterr().err


# --- Tout automatiser ---------------------------------------------------------------------------------

def test_auto_goes_from_a_folder_of_views_to_the_film(tmp_path, monkeypatch, capsys):
    pytest.importorskip("imageio_ffmpeg")
    monkeypatch.setattr(film, "WIDTH", 256)
    monkeypatch.setattr(film, "FPS", 6)
    save(tmp_path / "exports" / "1_entree.png", room())
    save(tmp_path / "exports" / "2_salon.png", room(400, 180))
    project = tmp_path / "projet"
    assert run("auto", project, "--depuis", tmp_path / "exports") == 0
    out = capsys.readouterr().out
    assert "2 vue(s) prise(s)" in out and "2 vue(s) retouchée(s)" in out and "Film prêt" in out
    assert (project / "sorties" / "film.mp4").is_file() and (project / "film.txt").is_file()
    assert run("auto", project, "--depuis", tmp_path / "exports") == 0       # rien de nouveau : rien n'est refait
    out = capsys.readouterr().out
    assert "2 déjà fait(s)" in out and "Film déjà à jour" in out
    assert run("auto", project, "--ia") == 1                                 # l'IA ne part jamais sans clé
    assert "clé API" in capsys.readouterr().err
    assert run("auto", tmp_path / "vide") == 1
    assert "--depuis" in capsys.readouterr().err


class FakeArchicad:
    """Archicad de test : répond à l'interface JSON et « publie » deux vues dans un sous-dossier."""

    def __init__(self, tapir=True):
        fake = self
        self.calls = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                fake.calls.append(request["command"])
                answer = json.dumps(fake.answer(request["command"], request["parameters"])).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(answer)))
                self.end_headers()
                self.wfile.write(answer)

            def log_message(self, *args):
                pass

        self.tapir = tapir
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def answer(self, command, parameters):
        if command == "API.IsAlive":
            return {"succeeded": True, "result": {"isAlive": True}}
        if command == "API.GetPublisherSetNames":
            return {"succeeded": True, "result": {"publisherSetNames": ["Plans", "Vues 3D"]}}
        if not self.tapir:
            return {"succeeded": False, "error": {"code": 4010, "message": "commande inconnue"}}
        assert parameters["addOnCommandId"] == {"commandNamespace": "TapirCommand", "commandName": "PublishPublisherSet"}
        target = parameters["addOnCommandParameters"]
        assert target["publisherSetName"] == "Vues 3D"
        save(Path(target["outputPath"]) / "Vues 3D" / "1_entree.png", room())
        save(Path(target["outputPath"]) / "Vues 3D" / "2_salon.png", room(400, 180))
        return {"succeeded": True, "result": {"addOnCommandResponse": {"success": True}}}

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def test_auto_asks_archicad_to_publish_the_views(tmp_path, monkeypatch, capsys):
    pytest.importorskip("imageio_ffmpeg")
    from rendu_ia import archicad
    monkeypatch.setattr(film, "WIDTH", 256)
    monkeypatch.setattr(film, "FPS", 6)
    fake = FakeArchicad()
    try:
        monkeypatch.setattr(archicad, "PORTS", [fake.port])
        project = tmp_path / "projet"
        assert run("auto", project, "--archicad", "Vues 3D") == 0
        assert "2 vue(s) reçue(s) d'Archicad" in capsys.readouterr().out
        assert sorted(path.name for path in (project / "captures").iterdir()) == ["1_entree.png", "2_salon.png"]
        assert (project / "sorties" / "film.mp4").is_file()
        assert run("auto", project, "--archicad", "Perspectives") == 1
        assert "jeux du projet : Plans, Vues 3D" in capsys.readouterr().err
    finally:
        fake.close()
    fake = FakeArchicad(tapir=False)
    try:
        monkeypatch.setattr(archicad, "PORTS", [fake.port])
        assert run("auto", tmp_path / "autre", "--archicad", "Vues 3D") == 1
        assert "Tapir" in capsys.readouterr().err
    finally:
        fake.close()
    assert run("auto", tmp_path / "autre", "--archicad", "Vues 3D") == 1     # Archicad fermé
    assert "Archicad ne répond pas" in capsys.readouterr().err
