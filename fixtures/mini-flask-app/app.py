from flask import Flask
from blueprints.users import users_bp
from blueprints.posts import posts_bp

app = Flask(__name__)

app.register_blueprint(users_bp, url_prefix='/api')
app.register_blueprint(posts_bp, url_prefix='/api')


@app.route('/')
def index():
    return {'status': 'ok'}


@app.route('/health')
def health():
    return {'status': 'healthy'}
