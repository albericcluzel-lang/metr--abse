import httpx
import pytest
from fal_client import FalClientHTTPError
from PIL import Image

from rendu_ia.config import ConfigError, FatalError
from rendu_ia.service import Fal, ServiceError, media_urls, prepare_image, result_suffix

from .conftest import make_image


def http_error(status: int) -> FalClientHTTPError:
    response = httpx.Response(status, request=httpx.Request("GET", "https://queue.fal.run/x"))
    return FalClientHTTPError("détail", status, {}, response=response)


@pytest.mark.parametrize("status", [401, 403])
def test_rejected_key_or_empty_balance_stops_everything(status):
    fal = Fal("cle")
    with pytest.raises(FatalError, match="FAL_KEY"):
        fal._call(lambda: (_ for _ in ()).throw(http_error(status)), "demande")
    fal.close()


def test_refused_request_only_fails_this_job():
    fal = Fal("cle")
    with pytest.raises(ServiceError, match="refusé par fal.ai \\(422\\)"):
        fal._call(lambda: (_ for _ in ()).throw(http_error(422)), "demande")
    with pytest.raises(ServiceError, match="erreur réseau"):
        fal._call(lambda: (_ for _ in ()).throw(httpx.ConnectError("hors ligne")), "demande")
    fal.close()


def test_missing_key_is_a_clear_error():
    with pytest.raises(ConfigError, match="FAL_KEY"):
        Fal("")


def test_media_urls_reads_every_answer_shape():
    assert media_urls({"images": [{"url": "a"}, {"url": "b"}]}) == ["a", "b"]
    assert media_urls({"image": {"url": "c"}}) == ["c"]
    assert media_urls({"video": {"url": "d"}}) == ["d"]
    assert media_urls({"images": [], "description": "refus"}) == []


@pytest.mark.parametrize("url, content_type, suffix", [
    ("https://v3.fal.media/files/x/out.PNG", "", ".png"),
    ("https://v3.fal.media/files/x/out.jpeg", "", ".jpg"),
    ("https://v3.fal.media/files/x/out", "video/mp4", ".mp4"),
    ("https://v3.fal.media/files/x/out", "image/jpeg; charset=binary", ".jpg"),
])
def test_result_suffix(url, content_type, suffix):
    assert result_suffix(url, content_type) == suffix


def test_small_image_is_sent_as_is(tmp_path):
    image = make_image(tmp_path / "capture.jpg")
    assert prepare_image(image, 2048, tmp_path) == image


def test_large_image_is_reduced(tmp_path):
    image = make_image(tmp_path / "capture.png", size=(3000, 1500))
    prepared = prepare_image(image, 2048, tmp_path)
    with Image.open(prepared) as result:
        assert result.size == (2048, 1024) and result.format == "JPEG"


def test_transparent_background_becomes_white(tmp_path):
    image = make_image(tmp_path / "export.png", mode="RGBA", color=(0, 0, 0, 0))
    with Image.open(prepare_image(image, 2048, tmp_path)) as result:
        assert result.getpixel((5, 5)) == (255, 255, 255)
