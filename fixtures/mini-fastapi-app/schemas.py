from pydantic import BaseModel
from typing import Optional


class UserSchema(BaseModel):
    id: int
    name: str
    email: str


class UserCreateSchema(BaseModel):
    name: str
    email: str


class PostSchema(BaseModel):
    id: int
    title: str
    author_id: int
