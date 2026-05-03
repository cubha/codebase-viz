from flask import Blueprint

users_bp = Blueprint('users', __name__)


@users_bp.route('/users')
def list_users():
    return []


@users_bp.route('/users/<int:user_id>')
def get_user(user_id):
    return {}


@users_bp.route('/users', methods=['POST'])
def create_user():
    return {}, 201
