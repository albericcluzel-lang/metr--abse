import json

import pytest

from rendu_ia import __main__ as cli
from rendu_ia import etapes, prompts
from rendu_ia.config import FatalError, Settings
from rendu_ia.service import VISION_ENDPOINT, FalProvider, ServiceError

from .conftest import FakeFal, make_image

STORYBOARD = json.dumps({"shots": [
    {"title": "Plan large", "image": "wide shot", "motion": "slow dolly-in"},
    {"title": "Détail parquet", "image": "close-up of the floor", "motion": "slow push-in on the floor"},
]})


def use_fal(monkeypatch, fal: FakeFal) -> FakeFal:
    """fal.ai remplacé par `fal` pour les images comme pour les vidéos."""
    monkeypatch.setenv("FAL_KEY", "test")
    monkeypatch.setattr(cli, "make_provider", lambda settings: FalProvider(settings, client=fal))
    monkeypatch.setattr(cli, "make_video_provider", lambda settings: FalProvider(settings, client=fal))
    return fal


@pytest.fixture
def fake(monkeypatch):
    return use_fal(monkeypatch, FakeFal(storyboard=STORYBOARD))


def run(*args) -> int:
    return cli.main([str(arg) for arg in args])


def test_simulation_sends_nothing(project, monkeypatch, capsys):
    def no_provider(settings):
        raise AssertionError("la simulation ne doit rien envoyer")
    monkeypatch.setattr(cli, "make_provider", no_provider)
    assert run("essais", project.root, "--capture", "salon") == 0
    assert run("rendus", project.root) == 0
    out = capsys.readouterr().out
    assert "[à faire] essais salon.png (4 image(s))" in out
    assert "[à faire] rendu cuisine.jpg" in out and "Ajoutez --apply" in out
    assert not project.output.exists()


def test_essais_needs_a_capture_when_there_are_several(project, capsys):
    assert run("essais", project.root) == 1
    assert "--capture" in capsys.readouterr().err


def test_essais_then_master_then_rendus(project, fake):
    assert run("essais", project.root, "--capture", "salon", "--nombre", "2", "--apply") == 0
    endpoint, arguments = fake.calls[0]
    assert endpoint == "fal-ai/nano-banana-pro/edit"
    assert arguments["num_images"] == 2 and arguments["resolution"] == "2K"
    assert [path.name for path in fake.uploads] == ["salon.png", "sol - parquet chene point de hongrie.jpg"]
    assert (project.output / "essais" / "salon_2.png").is_file()

    assert run("maitre", project.root, project.output / "essais" / "salon_2.png") == 0
    assert project.master() == project.output / "maitre.png"
    assert (project.output / "rendus" / "salon.png").read_bytes() == project.master().read_bytes()

    fake.calls.clear()
    fake.uploads.clear()
    assert run("rendus", project.root, "--apply") == 0
    # la vue de l'image maître est déjà faite : seule la cuisine est payée
    assert len(fake.calls) == 1
    endpoint, arguments = fake.calls[0]
    assert arguments["image_urls"] == ["https://cdn.test/cuisine.jpg", "https://cdn.test/maitre.png",
                                       "https://cdn.test/sol - parquet chene point de hongrie.jpg"]
    assert "Image 2 is the approved master image" in arguments["prompt"]
    assert (project.output / "rendus" / "cuisine.png").is_file()

    fake.calls.clear()
    assert run("rendus", project.root, "--apply") == 0
    assert fake.calls == []  # tout existe déjà : rien n'est repayé


def test_relocking_the_current_master_keeps_it(project):
    first = make_image(project.root / "choix.png", color="red")
    etapes.lock_master(project, first)
    master = project.master()
    etapes.lock_master(project, master)
    assert project.master().read_bytes() == first.read_bytes()


def test_master_with_another_extension_replaces_the_old_one(project):
    etapes.lock_master(project, make_image(project.root / "a.png"))
    etapes.lock_master(project, make_image(project.root / "b.jpg"))
    assert [path.name for path in project.output.glob("maitre.*")] == ["maitre.jpg"]


def test_variants_are_numbered(project, fake):
    assert run("rendus", project.root, "--capture", "cuisine", "--variantes", "2", "--apply") == 0
    assert sorted(path.name for path in (project.output / "rendus").iterdir()) == ["cuisine_1.png", "cuisine_2.png"]


def test_storyboard_then_upscale_then_video_follow_the_planned_motion(project, fake):
    etapes.lock_master(project, make_image(project.root / "choix.png"))
    assert run("storyboard", project.root, "--plans", "2", "--apply") == 0
    text_call = fake.calls[0]
    assert text_call[0] == VISION_ENDPOINT
    assert text_call[1]["model"] == "anthropic/claude-sonnet-5.5"
    assert text_call[1]["image_urls"] == ["https://cdn.test/maitre.png"]
    folder = project.output / "storyboard" / "maitre"
    saved = json.loads((folder / "storyboard.json").read_text(encoding="utf-8"))
    assert [plan["titre"] for plan in saved["plans"]] == ["Plan large", "Détail parquet"]
    plan_calls = fake.calls[1:]
    assert len(plan_calls) == 2
    assert all(arguments["image_urls"] == ["https://cdn.test/maitre.png"] for _, arguments in plan_calls)
    assert {path.name for path in folder.glob("plan_*")} == {"plan_1.png", "plan_2.png"}

    fake.calls.clear()
    assert run("storyboard", project.root, "--apply") == 0
    assert fake.calls == []  # storyboard et plans réutilisés

    assert run("upscale", project.root, "--apply") == 0
    assert (project.output / "upscale" / "storyboard" / "maitre" / "plan_2.png").is_file()

    fake.calls.clear()
    assert run("video", project.root, "--apply") == 0
    videos = {arguments["start_image_url"]: arguments for _, arguments in fake.calls}
    # les plans upscalés sont animés, avec le mouvement écrit dans le storyboard
    assert set(videos) == {"https://cdn.test/plan_1.png", "https://cdn.test/plan_2.png"}
    assert all(upload.parent.parts[-3:-1] == ("upscale", "storyboard") for upload in fake.uploads[-2:])
    prompts_sent = sorted(arguments["prompt"] for arguments in videos.values())
    assert "slow dolly-in" in prompts_sent[0] and "slow push-in on the floor" in prompts_sent[1]
    first = next(iter(videos.values()))
    assert first["duration"] == "5" and first["generate_audio"] is False
    assert (project.output / "videos" / "storyboard" / "maitre" / "plan_1.mp4").is_file()


def test_storyboard_without_text_model_uses_default_shots(project, fake, monkeypatch):
    monkeypatch.setenv("RENDU_MODELE_LLM", "aucun")
    etapes.lock_master(project, make_image(project.root / "choix.png"))
    assert run("storyboard", project.root, "--plans", "6", "--apply") == 0
    assert all(endpoint != VISION_ENDPOINT for endpoint, _ in fake.calls)
    assert len(fake.calls) == len(prompts.DEFAULT_SHOTS)


def test_unreadable_storyboard_is_reported(project, monkeypatch, capsys):
    use_fal(monkeypatch, FakeFal(storyboard="Désolé, je ne peux pas."))
    etapes.lock_master(project, make_image(project.root / "choix.png"))
    assert run("storyboard", project.root, "--apply") == 1
    assert "storyboard illisible" in capsys.readouterr().err
    assert not (project.output / "storyboard" / "maitre" / "storyboard.json").exists()


def test_video_with_seedance_and_custom_motion(project, fake):
    make_image(project.output / "rendus" / "salon.png")
    assert run("video", project.root, "--modele", "seedance", "--duree", "8", "--mouvement", "slow pan right",
               "--apply") == 0
    endpoint, arguments = fake.calls[0]
    assert endpoint == "bytedance/seedance-2.0/image-to-video"
    assert arguments["image_url"] == "https://cdn.test/salon.png"
    assert arguments["duration"] == "8" and arguments["resolution"] == "720p"
    assert "slow pan right" in arguments["prompt"]


def test_video_duration_is_checked_against_the_model(project, fake, capsys):
    make_image(project.output / "rendus" / "salon.png")
    assert run("video", project.root, "--modele", "seedance", "--duree", "3") == 1
    assert "entre 4 et 15" in capsys.readouterr().err


def test_explicit_files_outside_the_project(project, fake, tmp_path):
    image = make_image(tmp_path / "photo client.jpg")
    assert run("upscale", project.root, image, "--apply") == 0
    assert (project.output / "upscale" / "photo client.png").is_file()
    assert run("video", project.root, tmp_path / "absente.png") == 1


def test_one_failure_does_not_stop_the_others(project, capsys):
    settings = Settings.from_env()
    jobs = etapes.rendus_jobs(project, project.captures(), 1, False, 14)
    jobs[0].run = lambda provider: (_ for _ in ()).throw(ServiceError("contenu refusé"))
    report = etapes.execute(jobs, FalProvider(settings, client=FakeFal()), 2, print)
    assert len(report.errors) == 1 and "contenu refusé" in report.errors[0]
    assert len(report.produced) == 1 and report.aborted is None


def test_fatal_error_stops_jobs_not_started(project):
    settings = Settings.from_env()
    fal = FakeFal(fail={settings.image_model: FatalError("clé refusée")})
    report = etapes.execute(etapes.rendus_jobs(project, project.captures(), 1, False, 14),
                            FalProvider(settings, client=fal), 1, print)
    assert report.aborted == "clé refusée"
    assert len(fal.calls) == 1  # la seconde vue n'est pas envoyée
    assert report.produced == []


def test_missing_images_in_answer_are_an_error(project, tmp_path):
    class ShortFal(FakeFal):
        def run(self, endpoint, arguments, *, kind):
            return {"images": [], "description": "I can't edit this image."}
    with pytest.raises(ServiceError, match="0 image\\(s\\) reçue\\(s\\) sur 1.*can't edit"):
        FalProvider(Settings.from_env(), client=ShortFal()).generate_images(
            "prompt", [project.captures()[0]], [tmp_path / "out"])


def test_nouveau_creates_the_project_skeleton(tmp_path):
    assert run("nouveau", tmp_path / "villa") == 0
    assert (tmp_path / "villa" / "captures").is_dir() and (tmp_path / "villa" / "references").is_dir()
    assert (tmp_path / "villa" / "ambiance.txt").is_file()


@pytest.mark.parametrize("args", [["essais", "p", "--nombre", "5"], ["rendus", "p", "--variantes", "0"],
                                  ["storyboard", "p", "--plans", "9"], ["video", "p", "--modele", "sora"]])
def test_rejects_invalid_options(args):
    with pytest.raises(SystemExit):
        cli.build_parser().parse_args(args)


def age_project(project, seconds=100):
    """Vieillit tous les fichiers du projet, comme s'ils dataient d'un passage précédent."""
    import os
    import time
    past = time.time() - seconds
    for path in project.root.rglob("*"):
        if path.is_file():
            os.utime(path, (past, past))


def test_new_master_makes_renders_and_storyboard_out_of_date(project, fake, capsys):
    etapes.lock_master(project, make_image(project.root / "a.png", color="red"))
    assert run("rendus", project.root, "--apply") == 0
    assert run("storyboard", project.root, "--plans", "2", "--apply") == 0
    age_project(project)
    etapes.lock_master(project, project.master())  # même image : rien n'est à refaire
    capsys.readouterr()
    assert run("rendus", project.root) == 0
    assert "Rien de nouveau" in capsys.readouterr().out

    etapes.lock_master(project, make_image(project.root / "b.png", color="blue"))
    assert run("rendus", project.root) == 0
    assert capsys.readouterr().out.count("[à faire] rendu") == 2
    assert run("storyboard", project.root) == 0
    out = capsys.readouterr().out
    assert "il sera réécrit" in out and "[à faire] écrire le storyboard" in out

    fake.calls.clear()
    assert run("storyboard", project.root, "--plans", "2", "--apply") == 0
    assert [endpoint for endpoint, _ in fake.calls].count(VISION_ENDPOINT) == 1
    assert len(fake.calls) == 3  # storyboard réécrit et ses 2 plans refaits


def test_upscale_and_video_follow_a_redone_render(project, fake):
    make_image(project.output / "rendus" / "salon.png")
    assert run("upscale", project.root, "--apply") == 0
    age_project(project)
    make_image(project.output / "rendus" / "salon.png", color="white")  # rendu refait depuis
    fake.calls.clear()
    fake.uploads.clear()
    assert run("video", project.root, "--apply") == 0
    assert fake.uploads == [project.output / "rendus" / "salon.png"]  # pas l'ancienne version upscalée
    assert run("upscale", project.root, "--apply") == 0
    assert fake.calls[-1][0] == "fal-ai/seedvr/upscale/image"
