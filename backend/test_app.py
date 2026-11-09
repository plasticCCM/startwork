import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import urlopen
from app import Handler

class HealthTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = "http://127.0.0.1:" + str(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_health(self):
        with urlopen(self.base + "/health", timeout=3) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers.get_content_type(), "application/json")
            self.assertEqual(json.load(response), {"service": "startwork", "status": "ok", "stage": "scaffold"})

    def test_unknown_route(self):
        with self.assertRaises(HTTPError) as result:
            urlopen(self.base + "/courses", timeout=3)
        self.assertEqual(result.exception.code, 404)

if __name__ == "__main__":
    unittest.main()
