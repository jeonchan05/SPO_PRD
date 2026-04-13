const mapAuthUser = (user) => ({
  id: user.id,
  loginId: user.login_id,
  email: user.email,
  name: user.name,
  phoneNumber: user.phone_number || null,
  profileImageUrl: user.profile_image_url || null,
  role: user.role,
  status: user.status,
  createdAt: user.created_at,
});

const mapAppUser = (user) => ({
  id: user.id,
  loginId: user.login_id,
  email: user.email,
  name: user.name,
  phoneNumber: user.phone_number || null,
  profileImageUrl: user.profile_image_url || null,
  role: user.role,
  status: user.status,
  createdAt: user.created_at,
  updatedAt: user.updated_at,
});

module.exports = {
  mapAuthUser,
  mapAppUser,
};
