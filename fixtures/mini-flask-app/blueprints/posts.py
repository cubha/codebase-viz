from flask import Blueprint

posts_bp = Blueprint('posts', __name__)


@posts_bp.route('/posts')
def list_posts():
    return []


@posts_bp.route('/posts/<int:post_id>')
def get_post(post_id):
    return {}
