import base64
import io
import json

import httpx
import pytest
from PIL import Image

from rendu_ia import __main__ as cli
from rendu_ia import prompts
from rendu_ia.config import ConfigError, FatalError, Settings
from rendu_ia.gemini import GeminiProvider, closest_ratio
from rendu_ia.service import ServiceError

from .conftest import make_image

STORYBOARD = json.dumps({"plans": [
    {"titre": "Plan large", "image": "plan large", "mouvement": "travelling avant très lent"},
    {"titre": "Détail parquet", "image": "gros plan sur le parquet", "mouvement": "approche lente vers le parquet"},
]})


def png(color="white") -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (16, 9), color).save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode()


def image_answer(color="white") -> dict:
    return {"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "image/png", "data": png(color)}}]},
                            "finishReason": "STOP"}]}


def error_answer(code: int, status: str, message: str, details=()) -> httpx.Response:
    return httpx.Response(code, json={"error": {"code": code, "status": status, "message": message,
                                                "details": list(details)}})


class FakeGoogle:
    """Faux serveur de l'API Gemini : note les requêtes, répond dans l'ordre prévu (ou par défaut)."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.requests: list[httpx.Request] = []
        self.sleeps: list[float] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.answers:
            answer = self.answers.pop(0)
            return answer if isinstance(answer, httpx.Response) else httpx.Response(200, json=answer)
        if "gemini-3.5-flash" in request.url.path:
            return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": STORYBOARD}]}}]})
        return httpx.Response(200, json=image_answer())

    def bodies(self) -> list[dict]:
        return [json.loads(request.content) for request in self.requests]

    def provider(self, settings: Settings) -> GeminiProvider:
        return GeminiProvider(settings, transport=httpx.MockTransport(self), sleep=self.sleeps.append)


@pytest.fixture
def settings(monkeypatch) -> Settings:
    monkeypatch.setenv("GEMINI_API_KEY", "cle-google")
    return Settings.from_env()


def test_provider_is_gemini_when_a_google_key_is_set(monkeypatch):
    assert Settings.from_env().provider == "fal"
    monkeypatch.setenv("GOOGLE_API_KEY", "cle")
    settings = Settings.from_env()
    assert (settings.provider, settings.gemini_key, settings.text_model) == ("gemini", "cle", "gemini-3.5-flash-lite")
    assert settings.gemini_image_model == "gemini-3-pro-image"
    monkeypatch.setenv("RENDU_FOURNISSEUR", "fal")
    assert Settings.from_env().provider == "fal"
    monkeypatch.setenv("RENDU_FOURNISSEUR", "openai")
    with pytest.raises(ConfigError):
        Settings.from_env()


def test_text_model_can_be_turned_off(settings, monkeypatch):
    monkeypatch.setenv("RENDU_GEMINI_MODELE_TEXTE", "aucun")
    assert Settings.from_env().text_model is None


def test_missing_key_is_a_clear_error():
    with pytest.raises(ConfigError, match="GEMINI_API_KEY"):
        GeminiProvider(Settings())


def test_one_request_per_image_with_capture_first(settings, project, tmp_path):
    google = FakeGoogle()
    capture, reference = project.captures()[1], project.references()[0]   # salon.png 90x160, référence .jpg
    files = google.provider(settings).generate_images("PROMPT", [capture, reference], [tmp_path / "a", tmp_path / "b"])
    assert [file.name for file in files] == ["a.png", "b.png"]
    assert len(google.requests) == 2
    request = google.requests[0]
    assert request.url.path == "/v1beta/models/gemini-3-pro-image:generateContent"
    assert request.headers["x-goog-api-key"] == "cle-google"
    body = google.bodies()[0]
    parts = body["contents"][0]["parts"]
    assert parts[0] == {"text": "PROMPT"}
    assert [part["inlineData"]["mimeType"] for part in parts[1:]] == ["image/png", "image/jpeg"]
    assert base64.b64decode(parts[1]["inlineData"]["data"]) == capture.read_bytes()
    assert body["generationConfig"] == {"responseModalities": ["TEXT", "IMAGE"],
                                        "imageConfig": {"aspectRatio": "9:16", "imageSize": "2K"}}


def test_explicit_format_and_options_are_sent(monkeypatch, project, tmp_path):
    monkeypatch.setenv("GEMINI_API_KEY", "cle")
    monkeypatch.setenv("RENDU_FORMAT", "16:9")
    monkeypatch.setenv("RENDU_RESOLUTION", "4K")
    monkeypatch.setenv("RENDU_OPTIONS_IMAGE", '{"seed": 7}')
    google = FakeGoogle()
    google.provider(Settings.from_env()).generate_images("P", project.captures()[:1], [tmp_path / "a"])
    config = google.bodies()[0]["generationConfig"]
    assert config["imageConfig"] == {"aspectRatio": "16:9", "imageSize": "4K"}
    assert config["seed"] == 7


def test_thought_images_are_ignored(settings, project, tmp_path):
    answer = {"candidates": [{"content": {"parts": [
        {"inlineData": {"mimeType": "image/png", "data": png("black")}, "thought": True},
        {"text": "Composition validée."},
        {"inlineData": {"mimeType": "image/jpeg", "data": png("red")}},
    ]}}]}
    file = FakeGoogle(answer).provider(settings).generate_images("P", project.captures()[:1], [tmp_path / "a"])[0]
    assert file.name == "a.jpg"
    assert file.read_bytes() == base64.b64decode(png("red"))


def test_refusal_reports_the_model_explanation(settings, project, tmp_path):
    answer = {"candidates": [{"content": {"parts": [{"text": "I can't render this."}]}, "finishReason": "IMAGE_SAFETY"}]}
    with pytest.raises(ServiceError, match="IMAGE_SAFETY.*I can't render this"):
        FakeGoogle(answer).provider(settings).generate_images("P", project.captures()[:1], [tmp_path / "a"])
    with pytest.raises(ServiceError, match="bloquée.*PROHIBITED_CONTENT"):
        FakeGoogle({"promptFeedback": {"blockReason": "PROHIBITED_CONTENT"}}).provider(settings).generate_images(
            "P", project.captures()[:1], [tmp_path / "a"])


@pytest.mark.parametrize("response, message", [
    (error_answer(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key.",
                  [{"reason": "API_KEY_INVALID"}]), "GEMINI_API_KEY"),
    (error_answer(429, "RESOURCE_EXHAUSTED", "Quota exceeded for metric: generate_content_free_tier_requests, "
                  "limit: 0, model: gemini-3-pro-image"), "facturation"),
    (error_answer(403, "PERMISSION_DENIED", "Permission denied"), "refuse l'accès"),
    (error_answer(404, "NOT_FOUND", "models/gemini-9 is not found"), "introuvable"),
])
def test_errors_that_would_hit_every_image_stop_everything(settings, project, tmp_path, response, message):
    google = FakeGoogle(response)
    with pytest.raises(FatalError, match=message):
        google.provider(settings).generate_images("P", project.captures()[:1], [tmp_path / "a"])
    assert google.sleeps == []


def test_busy_server_is_retried(settings, project, tmp_path):
    busy = error_answer(429, "RESOURCE_EXHAUSTED", "Too many requests", [{"retryDelay": "7s"}])
    google = FakeGoogle(error_answer(503, "UNAVAILABLE", "overloaded"), busy, image_answer())
    files = google.provider(settings).generate_images("P", project.captures()[:1], [tmp_path / "a"])
    assert files[0].is_file()
    assert google.sleeps == [5, 7.0]


def test_gives_up_after_several_failures(settings, project, tmp_path):
    google = FakeGoogle(*[error_answer(503, "UNAVAILABLE", "overloaded")] * 5)
    with pytest.raises(ServiceError, match="503 UNAVAILABLE"):
        google.provider(settings).generate_images("P", project.captures()[:1], [tmp_path / "a"])
    assert google.sleeps == [5, 15, 30, 60]


def test_storyboard_text_request(settings, project):
    answer = {"candidates": [{"content": {"parts": [{"text": "pensée", "thought": True}, {"text": STORYBOARD}]}}]}
    google = FakeGoogle(answer)
    text = google.provider(settings).write_text(project.captures()[0], "SYSTEM", "REQUEST")
    assert text == STORYBOARD
    assert google.requests[0].url.path == "/v1beta/models/gemini-3.5-flash-lite:generateContent"
    body = google.bodies()[0]
    assert body["systemInstruction"] == {"parts": [{"text": "SYSTEM"}]}
    config = body["generationConfig"]
    assert config["responseMimeType"] == "application/json"
    assert config["thinkingConfig"] == {"thinkingLevel": "low"}
    assert config["mediaResolution"] == "MEDIA_RESOLUTION_MEDIUM"
    assert "responseSchema" not in config
    assert body["contents"][0]["parts"][0] == {"text": "REQUEST"}


def test_upscale_regenerates_in_4k(settings, project, tmp_path):
    source = make_image(tmp_path / "rendu.png", size=(300, 200))
    google = FakeGoogle()
    google.provider(settings).upscale(source, tmp_path / "grand")
    body = google.bodies()[0]
    assert body["contents"][0]["parts"][0] == {"text": prompts.UPSCALE_PROMPT}
    assert body["generationConfig"]["imageConfig"] == {"aspectRatio": "3:2", "imageSize": "4K"}


@pytest.mark.parametrize("size, ratio", [((1920, 1080), "16:9"), ((1080, 1920), "9:16"), ((1000, 1000), "1:1"),
                                         ((1500, 1000), "3:2"), ((1024, 768), "4:3"), ((2520, 1080), "21:9")])
def test_closest_ratio(tmp_path, size, ratio):
    assert closest_ratio(make_image(tmp_path / "image.png", size=size)) == ratio


def test_whole_workflow_with_gemini_and_flow(settings, project, monkeypatch, capsys):
    google = FakeGoogle()
    monkeypatch.setattr(cli, "make_provider", google.provider)

    def no_video(settings):
        raise AssertionError("sans clé fal.ai, aucune vidéo n'est envoyée")
    monkeypatch.setattr(cli, "make_video_provider", no_video)

    def run(*args):
        return cli.main([str(arg) for arg in args])

    assert run("essais", project.root, "--capture", "salon", "--nombre", "2", "--apply") == 0
    assert len(google.requests) == 2
    assert run("maitre", project.root, project.output / "essais" / "salon_1.png") == 0
    assert run("rendus", project.root, "--apply") == 0
    rendu = google.bodies()[-1]["contents"][0]["parts"]
    assert len(rendu) == 4   # consigne, capture de la cuisine, image maître, référence
    assert "Image 2 : image maître validée" in rendu[0]["text"]
    assert run("storyboard", project.root, "--plans", "2", "--apply") == 0
    assert run("upscale", project.root, "--apply") == 0
    assert (project.output / "upscale" / "storyboard" / "maitre" / "plan_2.png").is_file()
    capsys.readouterr()

    count = len(google.requests)
    assert run("video", project.root) == 0
    assert len(google.requests) == count
    sheet = (project.output / "videos" / "a_faire_dans_flow.txt").read_text(encoding="utf-8")
    assert "Frames to Video" in sheet
    assert "travelling avant très lent" in sheet and "approche lente vers le parquet" in sheet
    assert str(project.output / "upscale" / "storyboard" / "maitre" / "plan_1.png") in sheet
    assert "Flow" in capsys.readouterr().out


def test_simulation_names_gemini(settings, project, capsys):
    assert cli.main(["rendus", str(project.root)]) == 0
    assert "Gemini (gemini-3-pro-image)" in capsys.readouterr().out


def test_free_model_is_limited_to_1k_and_three_images(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "cle")
    monkeypatch.setenv("RENDU_GEMINI_MODELE_IMAGE", "gemini-3.1-flash-lite-image")
    settings = Settings.from_env()
    assert (settings.resolution, settings.image_limits) == ("1K", (3, "1K"))
    monkeypatch.setenv("RENDU_RESOLUTION", "2K")
    with pytest.raises(ConfigError, match="1K au plus"):
        Settings.from_env()


def test_default_resolution_is_2k_for_pro(settings):
    assert (settings.resolution, settings.image_limits) == ("2K", (14, "4K"))


def test_free_model_gets_only_the_references_it_accepts(monkeypatch, project, capsys):
    monkeypatch.setenv("GEMINI_API_KEY", "cle")
    monkeypatch.setenv("RENDU_GEMINI_MODELE_IMAGE", "gemini-3.1-flash-lite-image")
    make_image(project.root / "references" / "tissu - bouclette.jpg")
    google = FakeGoogle()
    monkeypatch.setattr(cli, "make_provider", google.provider)
    assert cli.main(["essais", str(project.root), "--capture", "salon", "--nombre", "1", "--apply"]) == 0
    parts = google.bodies()[-1]["contents"][0]["parts"]
    assert len(parts) == 4   # consigne, capture et 2 références
    assert google.bodies()[-1]["generationConfig"]["imageConfig"]["imageSize"] == "1K"

    assert cli.main(["maitre", str(project.root), str(project.output / "essais" / "salon_1.png")]) == 0
    capsys.readouterr()
    assert cli.main(["rendus", str(project.root), "--apply"]) == 0
    assert "n'en accepte que 1" in capsys.readouterr().out
    parts = google.bodies()[-1]["contents"][0]["parts"]
    assert len(parts) == 4   # consigne, capture, image maître et 1 seule référence
    assert "image 3 : sol - parquet chene point de hongrie" in parts[0]["text"]
    assert "tissu - bouclette" not in parts[0]["text"]


def test_free_model_cannot_upscale(monkeypatch, project, capsys):
    monkeypatch.setenv("GEMINI_API_KEY", "cle")
    monkeypatch.setenv("RENDU_GEMINI_MODELE_IMAGE", "gemini-3.1-flash-lite-image")
    make_image(project.output / "rendus" / "salon.png")
    assert cli.main(["upscale", str(project.root)]) == 1
    assert "ne peut pas agrandir" in capsys.readouterr().err


def test_daily_quota_stops_everything_without_retrying(settings, project, tmp_path):
    exhausted = error_answer(429, "RESOURCE_EXHAUSTED", "Quota exceeded for metric: "
                             "generate_content_free_tier_requests, limit: 20, model: gemini-3.1-flash-lite-image",
                             [{"violations": [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}])
    google = FakeGoogle(exhausted)
    with pytest.raises(FatalError, match="Quota du jour"):
        google.provider(settings).generate_images("P", project.captures()[:1], [tmp_path / "a"])
    assert google.sleeps == []


def test_free_path_existing_image_to_flow_sheet(settings, project, monkeypatch, tmp_path, capsys):
    """Parcours gratuit : une image existante, les consignes par le modèle de texte gratuit, la fiche Flow."""
    google = FakeGoogle()
    monkeypatch.setattr(cli, "make_provider", google.provider)
    facade = make_image(tmp_path / "images agence" / "facade.jpg", size=(1080, 1920))
    assert cli.main(["storyboard", str(project.root), "--image", str(facade), "--plans", "2",
                     "--sans-images", "--apply"]) == 0
    assert len(google.requests) == 1
    assert google.requests[0].url.path == "/v1beta/models/gemini-3.5-flash-lite:generateContent"
    assert "Tous les plans partent de cette image" in google.bodies()[0]["contents"][0]["parts"][0]["text"]
    folder = project.output / "storyboard" / "facade"
    assert [path.read_bytes() == facade.read_bytes() for path in sorted(folder.glob("plan_*"))] == [True, True]

    assert cli.main(["storyboard", str(project.root), "--image", str(facade), "--sans-images", "--apply"]) == 0
    assert len(google.requests) == 1   # storyboard et plans déjà à jour : rien n'est redemandé

    assert cli.main(["video", str(project.root)]) == 0
    sheet = (project.output / "videos" / "a_faire_dans_flow.txt").read_text(encoding="utf-8")
    assert "storyboard/facade/plan_1" in sheet and "storyboard/facade/plan_2" in sheet
    assert "travelling avant très lent" in sheet and "approche lente vers le parquet" in sheet
    assert len(google.requests) == 1


def test_without_images_needs_no_key_with_default_shots(project, monkeypatch, capsys):
    monkeypatch.setenv("RENDU_GEMINI_MODELE_TEXTE", "aucun")
    monkeypatch.setenv("RENDU_FOURNISSEUR", "gemini")

    def no_provider(settings):
        raise AssertionError("aucun appel n'est nécessaire")
    monkeypatch.setattr(cli, "make_provider", no_provider)
    image = make_image(project.root / "rendu.png")
    assert cli.main(["storyboard", str(project.root), "--image", str(image), "--sans-images"]) == 0
    assert "aucune image ne sera générée" in capsys.readouterr().out
    assert cli.main(["storyboard", str(project.root), "--image", str(image), "--sans-images", "--apply"]) == 0
    assert len(list((project.output / "storyboard" / "rendu").glob("plan_*"))) == len(prompts.DEFAULT_SHOTS)


def test_storyboard_request_carries_the_answer_format(settings, project, monkeypatch):
    google = FakeGoogle()
    monkeypatch.setattr(cli, "make_provider", google.provider)
    image = make_image(project.root / "rendu.png")
    assert cli.main(["storyboard", str(project.root), "--image", str(image), "--sans-images", "--apply"]) == 0
    schema = google.bodies()[0]["generationConfig"]["responseSchema"]
    assert schema["properties"]["plans"]["items"]["required"] == ["titre", "mouvement"]


def test_refused_economy_settings_fall_back_to_a_plain_request(settings, project):
    refused = error_answer(400, "INVALID_ARGUMENT", "Unknown name \"mediaResolution\"")
    google = FakeGoogle(refused)
    text = google.provider(settings).write_text(project.captures()[0], "SYSTEM", "REQUEST", {"type": "OBJECT"})
    assert text == STORYBOARD
    first, second = google.bodies()
    assert "thinkingConfig" in first["generationConfig"]
    assert second["generationConfig"] == {"responseMimeType": "application/json"}


def test_refusals_other_than_bad_settings_are_not_retried(settings, project):
    google = FakeGoogle(error_answer(422, "INVALID_ARGUMENT", "contenu refusé"))
    with pytest.raises(ServiceError, match="contenu refusé"):
        google.provider(settings).write_text(project.captures()[0], "SYSTEM", "REQUEST")
    assert len(google.requests) == 1
