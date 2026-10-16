import json

import pytest

from rendu_ia import prompts
from rendu_ia.config import VIDEO_MODELS, ConfigError, Settings
from rendu_ia.projet import Project, reference_label


def test_default_settings_follow_the_reference_video():
    settings = Settings.from_env()
    assert settings.image_model == "fal-ai/nano-banana-pro/edit"
    assert (settings.resolution, settings.aspect_ratio) == ("2K", "auto")
    assert settings.video == VIDEO_MODELS["kling"]
    assert settings.llm_model == "anthropic/claude-sonnet-5.5"


def test_settings_are_read_and_normalised(monkeypatch):
    monkeypatch.setenv("RENDU_RESOLUTION", "4k")
    monkeypatch.setenv("RENDU_FORMAT", "9:16")
    monkeypatch.setenv("RENDU_MODELE_LLM", "Aucun")
    monkeypatch.setenv("RENDU_MODELE_VIDEO", "Seedance")
    monkeypatch.setenv("RENDU_ENDPOINT_VIDEO", "bytedance/seedance-2.1/image-to-video")
    monkeypatch.setenv("RENDU_FACTEUR_UPSCALE", "1,5")
    monkeypatch.setenv("RENDU_OPTIONS_IMAGE", '{"seed": 42}')
    settings = Settings.from_env()
    assert (settings.resolution, settings.aspect_ratio, settings.llm_model) == ("4K", "9:16", None)
    assert settings.video.endpoint == "bytedance/seedance-2.1/image-to-video"
    assert settings.video.image_field == "image_url"
    assert settings.upscale_factor == 1.5
    assert settings.image_options == {"seed": 42}


@pytest.mark.parametrize("name, value", [
    ("RENDU_RESOLUTION", "8K"),
    ("RENDU_FORMAT", "10:3"),
    ("RENDU_MODELE_VIDEO", "sora"),
    ("RENDU_DUREE_VIDEO", "20"),
    ("RENDU_DUREE_VIDEO", "cinq"),
    ("RENDU_PARALLELE", "0"),
    ("RENDU_FACTEUR_UPSCALE", "8"),
    ("RENDU_OPTIONS_VIDEO", "{seed: 1}"),
    ("RENDU_OPTIONS_VIDEO", "[1, 2]"),
])
def test_invalid_settings_are_reported(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ConfigError):
        Settings.from_env()


def test_seedance_needs_at_least_four_seconds(monkeypatch):
    monkeypatch.setenv("RENDU_MODELE_VIDEO", "seedance")
    monkeypatch.setenv("RENDU_DUREE_VIDEO", "3")
    with pytest.raises(ConfigError):
        Settings.from_env()


def test_render_prompt_numbers_images_in_the_order_they_are_sent():
    text = prompts.render_prompt(master=True, references=["sol parquet", "tissu canape"], brief=None, people=False)
    assert "Image 1 : capture de la maquette 3D" in text
    assert "Image 2 : image maître validée" in text
    assert "image 3 : sol parquet ; image 4 : tissu canape" in text
    assert "Ajoute une ou deux personnes" not in text and "Consignes de l'architecte" not in text


def test_render_prompt_without_master_starts_references_at_image_2():
    text = prompts.render_prompt(master=False, references=["sol"], brief="Esprit années 60.", people=True)
    assert "master" not in text
    assert "image 2 : sol" in text
    assert "Ajoute une ou deux personnes" in text
    assert text.index("Esprit années 60.") > text.index(prompts.LIGHT)  # le brief passe après les défauts


def test_parse_storyboard_accepts_fenced_json_and_keeps_requested_count():
    shots = [{"titre": f"Plan {i}", "image": f"cadrage {i}", "mouvement": f"mouvement {i}"} for i in range(1, 6)]
    text = "Voici :\n```json\n" + json.dumps({"plans": shots}) + "\n```"
    parsed = prompts.parse_storyboard(text, 4)
    assert [shot.image for shot in parsed] == ["cadrage 1", "cadrage 2", "cadrage 3", "cadrage 4"]
    assert parsed[0].motion == "mouvement 1"


def test_parse_storyboard_fills_missing_title_and_motion():
    parsed = prompts.parse_storyboard('{"plans": [{"image": "plan large"}]}', 4)
    assert parsed == [prompts.Shot("Plan 1", "plan large", prompts.DEFAULT_MOTION)]


@pytest.mark.parametrize("text", ["pas de json", '{"plans": []}', '{"shots": [{"image": "x"}]}',
                                  '{"plans": [{"titre": "x"}]}', '{"plans": [oops]}'])
def test_parse_storyboard_rejects_unusable_answers(text):
    with pytest.raises(ValueError):
        prompts.parse_storyboard(text, 4)


def test_video_prompt_uses_default_motion():
    assert prompts.DEFAULT_MOTION in prompts.video_prompt(None)
    assert "panoramique lent" in prompts.video_prompt("panoramique lent")
    assert prompts.VIDEO_STYLES["dynamique"] in prompts.video_prompt(None, "dynamique")


def test_storyboard_request_asks_for_french_camera_moves_only():
    text = prompts.storyboard_request(3, "dynamique")
    assert "3 plans" in text and prompts.AMBIANCES["dynamique"] in text
    assert "ne redécris pas l'architecture" in text and "vue FPV" in text
    assert '"plans"' in text and '"mouvement"' in text


def test_project_lists_images_only_sorted_and_reads_brief(project):
    assert [path.name for path in project.captures()] == ["cuisine.jpg", "salon.png"]
    assert project.brief() is None  # le modèle d'ambiance.txt n'a que des commentaires
    (project.root / "ambiance.txt").write_text("# note\nLumière du soir.\n", encoding="utf-8")
    assert project.brief() == "Lumière du soir."


def test_find_capture_by_name_or_stem(project):
    assert project.find_capture("SALON").name == "salon.png"
    assert project.find_capture("cuisine.jpg").name == "cuisine.jpg"
    with pytest.raises(ConfigError, match="cuisine.jpg, salon.png"):
        project.find_capture("chambre")


def test_open_requires_a_project_folder(tmp_path):
    with pytest.raises(ConfigError):
        Project.open(tmp_path)


def test_reference_label_comes_from_file_name(tmp_path):
    assert reference_label(tmp_path / "mur_enduit  chaux.jpg") == "mur enduit chaux"
